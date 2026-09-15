"use client";

import { ServiceEntitlementPrompt } from "@/src/features/reading/ServiceEntitlementPrompt";
import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type HomeOverview, type WisdomSeedAccount } from "@/src/api/client";
import { DailyGenerating, DailyStart } from "@/src/features/legacy/LegacyProfileFlow";
import { ProtectedRoute } from "@/src/shared/guards";
import { dailyReportPath, ROUTES } from "@/src/shared/routes";
import { RouteFrame } from "@/src/shared/shell";
import { apiMessage, PageDebugLabel } from "@/src/shared/ui";
import { invalidateQuery } from "@/src/shared/query";
import { createOrRetryDailyInsight } from "./dailyRetry";
import { dailyReducer, initialDailyMachine } from "./dailyMachine";

export default function DailyScreen() {
  const [machine, dispatch] = useReducer(dailyReducer, initialDailyMachine);
  const [home, setHome] = useState<HomeOverview | null>(null);
  const [account, setAccount] = useState<WisdomSeedAccount | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [busy, setBusy] = useState(false);
  const createLock = useRef(false);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    void Promise.all([api.home(), api.seedAccount()]).then(([overview, seeds]) => {
      if (!active) return;
      setHome(overview);
      setAccount(seeds);
      const daily = overview.dailyInsight;
      if (daily.state === "READY" && daily.localDate) {
        dispatch({ type: "READY" });
        router.replace(dailyReportPath(daily.localDate));
      } else if (daily.state === "GENERATING" && daily.taskId) {
        setTaskId(daily.taskId);
        dispatch({ type: "GENERATE" });
      } else dispatch({ type: "RESTORE_START" });
    }).catch((reason) => {
      if (active) {
        setError(apiMessage(reason));
        dispatch({ type: "FAIL", recoverTo: "start" });
      }
    });
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (machine.state !== "generating" || !taskId) return;
    const timer = window.setInterval(() => {
      void api.generationTask(taskId).then(async (task) => {
        if (task.status === "READY") {
          window.clearInterval(timer);
          invalidateQuery("home:overview");
          invalidateQuery("my:seeds");
          const date = home?.dailyInsight.localDate ?? new Date().toISOString().slice(0, 10);
          await api.dailyInsight(date);
          dispatch({ type: "READY" });
          router.replace(dailyReportPath(date));
        } else if (task.status === "FAILED") {
          window.clearInterval(timer);
          setError(task.failure?.message || "今日指引生成失败，本次体验额度会自动恢复");
          dispatch({ type: "FAIL", recoverTo: "generating" });
        }
      }).catch((reason) => setError(apiMessage(reason)));
    }, 1200);
    return () => window.clearInterval(timer);
  }, [home?.dailyInsight.localDate, machine.state, router, taskId]);

  async function create() {
    if (createLock.current) return;
    createLock.current = true;
    setBusy(true);
    setError("");
    setErrorCode("");
    try {
      const result = await createOrRetryDailyInsight(api);
      invalidateQuery("home:overview");
      invalidateQuery("my:seeds");
      setTaskId(result.task?.taskId ?? result.dailyInsight.taskId ?? null);
      setAccount(await api.seedAccount());
      if (result.dailyInsight.status === "READY") {
        dispatch({ type: "READY" });
        router.replace(dailyReportPath(result.dailyInsight.localDate));
      } else dispatch({ type: "GENERATE" });
    } catch (reason) {
      setError(apiMessage(reason));
      setErrorCode(reason instanceof ApiError ? reason.code : "");
      dispatch({ type: "FAIL", recoverTo: "start" });
    } finally {
      createLock.current = false;
      setBusy(false);
    }
  }

  const name = home?.profile.displayName || "你";
  const balance = account?.available ?? null;
  const energy = home?.dailyEnergySummary.data?.energyLevel;
  let body;
  if (machine.state === "loading") body = <div className="legal-state" aria-live="polite"><i>芽</i><p>正在恢复今天的指引…</p></div>;
  else if (machine.state === "start") body = <DailyStart name={name} energyLevel={energy} balance={balance} costLabel="1 次今日能量权益" onBack={() => router.push(ROUTES.home)} onNext={() => void create()} />;
  else if (machine.state === "generating") body = <DailyGenerating name={name} balance={balance} onBack={() => router.push(ROUTES.home)} />;
  else if (errorCode === "PURCHASE_REQUIRED") body = <><DailyStart name={name} energyLevel={energy} balance={balance} costLabel="1 次今日能量权益" onBack={() => router.push(ROUTES.home)} onNext={() => void create()} /><ServiceEntitlementPrompt kind="daily" /></>;
  else body = <div className="legal-state legal-error" role="alert"><i>!</i><h1>今日指引暂时没有完成</h1><p>{error || "可以安全重试，不会重复扣除智慧种子。"}</p><button disabled={busy} onClick={() => void create()}>{busy ? "正在提交重试…" : "返回重试"}</button></div>;

  const pageCode = machine.state === "generating" ? "DAILY-02" : "DAILY-01";
  return <ProtectedRoute><RouteFrame title="每日指引" label="每日指引"><div className="profile-flow"><PageDebugLabel>{`R1.0 · ${pageCode}`}</PageDebugLabel>{body}</div></RouteFrame></ProtectedRoute>;
}
