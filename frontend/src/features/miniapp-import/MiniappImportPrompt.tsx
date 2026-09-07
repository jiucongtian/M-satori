"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, type MiniappImportDecision, type MiniappImportStatus } from "@/src/api/client";
import { clearQueryCache } from "@/src/shared/query";
import { ROUTES } from "@/src/shared/routes";
import "./miniapp-import.css";

type PendingDecision = { decision: MiniappImportDecision; requestKey: string };

function requestKey() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `miniapp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function MiniappImportPrompt() {
  const [offer, setOffer] = useState<MiniappImportStatus | null>(null);
  const [chosenDecision, setChosenDecision] = useState<MiniappImportDecision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MiniappImportStatus | null>(null);
  const [acceptedPending, setAcceptedPending] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pendingRef = useRef<PendingDecision | null>(null);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let loading = false;
    let resolved = false;
    const check = async () => {
      if (loading || resolved) return;
      loading = true;
      try {
        const current = await api.miniappImportStatus();
        if (!mountedRef.current) return;
        resolved = true;
        if (current.status === "OFFERED" && current.offerId) setOffer(current);
        if (current.status === "ACCEPTED") setAcceptedPending(true);
      } catch {
        // A failed eligibility check never counts as a user's decision.
      } finally {
        loading = false;
      }
    };
    void check();
    window.addEventListener("online", check);
    window.addEventListener("focus", check);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("online", check);
      window.removeEventListener("focus", check);
    };
  }, []);

  useEffect(() => {
    if (!acceptedPending) return;
    let stopped = false;
    let inFlight = false;
    let suspended = document.hidden;
    let failures = 0;
    let timer: number | undefined;
    const schedule = (delay: number) => {
      if (stopped || suspended || document.hidden) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (stopped || inFlight || suspended || document.hidden || !navigator.onLine) return;
      inFlight = true;
      let finished = false;
      try {
        const current = await api.miniappImportStatus();
        if (stopped || !mountedRef.current) return;
        if (current.status === "COMPLETED" || current.status === "DECLINED") {
          finished = true;
          setAcceptedPending(false);
          if (current.status === "COMPLETED") {
            clearQueryCache();
            window.dispatchEvent(new Event("satori:miniapp-import-completed"));
          }
          // A dismissed acknowledgement stays dismissed; background completion is never a new offer.
          setResult((openResult) => openResult && current.status === "COMPLETED" ? current : null);
        } else if (current.status === "ACCEPTED") {
          failures = 0;
        } else {
          failures += 1;
        }
      } catch {
        failures += 1;
      } finally {
        inFlight = false;
        if (!finished) schedule(Math.min(60_000, 5_000 * 2 ** Math.min(failures, 4)));
      }
    };
    const pause = () => {
      suspended = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
    const resume = () => {
      if (document.hidden) return;
      suspended = false;
      void poll();
    };
    const visibility = () => { if (document.hidden) pause(); else resume(); };
    schedule(5_000);
    window.addEventListener("blur", pause);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("blur", pause);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [acceptedPending]);

  const visible = Boolean(offer || result);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!visible || !dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [visible]);

  function finish(current: MiniappImportStatus) {
    if (!mountedRef.current) return;
    setOffer(null);
    setError("");
    setAcceptedPending(current.status === "ACCEPTED");
    if (current.status === "COMPLETED" || current.status === "ACCEPTED") {
      clearQueryCache();
      if (current.status === "COMPLETED") window.dispatchEvent(new Event("satori:miniapp-import-completed"));
      setResult(current);
    }
  }

  async function decide(decision: MiniappImportDecision) {
    if (!offer?.offerId || submittingRef.current) return;
    if (pendingRef.current && pendingRef.current.decision !== decision) return;
    const pending = pendingRef.current ?? {
      decision,
      requestKey: requestKey(),
    };
    pendingRef.current = pending;
    submittingRef.current = true;
    setChosenDecision(decision);
    setBusy(true);
    setError("");
    try {
      const current = await api.decideMiniappImport(offer.offerId, decision, pending.requestKey);
      if (current.status === "OFFERED") throw new Error("Decision not yet saved");
      finish(current);
    } catch (reason) {
      // A response can be lost after the server saved the choice. Reconcile before retrying.
      const current = await api.miniappImportStatus().catch(() => null);
      if (!mountedRef.current) return;
      if (current && current.status !== "OFFERED") finish(current);
      else if (
        reason instanceof ApiError && reason.status === 409 && reason.code === "MINIAPP_OFFER_UNAVAILABLE" &&
        current?.status === "OFFERED" && current.offerId && current.offerId !== offer.offerId
      ) {
        // Only an explicit stale-offer rejection permits changing a previously submitted payload.
        setOffer(current);
        pendingRef.current = { decision, requestKey: requestKey() };
        setError("导入信息已更新，已保留你的选择。请重试提交，无需重新选择。");
      } else setError("暂未收到确认，请重试提交同一选择。重试不会重复导入。");
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <dialog
      ref={dialogRef}
      className="miniapp-import-dialog"
      aria-labelledby="miniapp-import-title"
      aria-describedby="miniapp-import-description"
      onCancel={(event) => event.preventDefault()}
    >
      <div className="miniapp-import-content">
        <div className="miniapp-import-mark" aria-hidden="true">档</div>
        {offer ? <>
          <p className="miniapp-import-eyebrow">旧档案导入</p>
          <h2 id="miniapp-import-title">找到了你的小程序档案</h2>
          <p id="miniapp-import-description">
            你当前登录的手机号，在「身心游卡牌微信小程序」中有
            {offer.profileCount ? <strong> {offer.profileCount} 份</strong> : "可导入的"}档案。是否导入到当前账号？
          </p>
          <p className="miniapp-import-details">原档案会保留在生命智慧档案库，关系统一为「朋友」，出生地默认为「北京」，导入后可修改。小程序原始资料和旧卡牌会保留，导入后的卡牌按现行规则生成。</p>
          <div className="miniapp-import-notice">
            <strong>仅此一次，请确认后选择</strong>
            <p>这个导入提醒只会有一次。无论选择导入或不导入，之后都不会再次提醒，也不会再有导入机会。</p>
          </div>
          {error && <p className="miniapp-import-error" role="alert">{error}</p>}
          <div className="miniapp-import-actions" aria-busy={busy}>
            {chosenDecision ? <button className="miniapp-import-primary" disabled={busy} onClick={() => void decide(chosenDecision)}>
              {busy ? (chosenDecision === "ACCEPT" ? "正在导入，请稍候…" : "正在保存选择…") : "重试提交我的选择"}
            </button> : <>
              <button className="miniapp-import-primary" onClick={() => void decide("ACCEPT")}>同意导入</button>
              <button className="miniapp-import-secondary" onClick={() => void decide("DECLINE")}>不导入，放弃此次机会</button>
            </>}
          </div>
        </> : <>
          <h2 id="miniapp-import-title">{result?.status === "COMPLETED" ? "旧档案已导入" : "已收到你的导入选择"}</h2>
          <p id="miniapp-import-description">
            {result?.status === "COMPLETED"
              ? `已添加 ${result.importedCount ?? result.profileCount ?? "相关"} 份朋友档案，你可以在档案库中查看。`
              : "系统正在处理你的旧档案，完成后可在档案库中查看。无需再次提交。"}
          </p>
          <div className="miniapp-import-actions">
            <button className="miniapp-import-primary" onClick={() => window.location.assign(ROUTES.myArchive)}>查看档案库</button>
            <button className="miniapp-import-secondary" onClick={() => setResult(null)}>继续使用</button>
          </div>
        </>}
      </div>
    </dialog>
  );
}
