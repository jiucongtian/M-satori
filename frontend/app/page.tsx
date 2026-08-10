"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "@/src/api/client";
import type { Bootstrap, DailyInsight, HomeOverview, LifeProfile, Location, ProfileRevision, WisdomSeedAccount, WisdomSeedTransaction } from "@/src/api/client";

type View = "welcome" | "login" | "recovery" | "profile";
type LoginIntent = "new" | "existing";

function apiMessage(error: unknown) {
  if (error instanceof ApiError) return `${error.message}${error.requestId ? `（请求 ${error.requestId}）` : ""}`;
  return "网络连接失败，请稍后重试";
}

function stepForAction(action: string) {
  if (action === "CONFIRM_PROFILE") return 5;
  if (action === "CLAIM_REGISTRATION_REWARD") return 9;
  if (action === "CREATE_TODAY_DAILY_INSIGHT" || action === "VIEW_HOME") return 10;
  return 0;
}

export default function WelcomePage() {
  const [view, setView] = useState<View>("welcome");
  const [started, setStarted] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [message, setMessage] = useState("");
  const [resumeStep, setResumeStep] = useState(0);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [challengeId, setChallengeId] = useState("");
  const [busy, setBusy] = useState(false);

  const normalizedPhone = phone.replace(/\D/g, "").slice(0, 11);
  const phoneReady = /^1\d{10}$/.test(normalizedPhone);
  const codeReady = /^\d{6}$/.test(code);

  useEffect(() => {
    let active = true;
    api.bootstrap().then((value) => active && setBootstrap(value)).catch(() => undefined);
    api.refresh().then(async (restored) => {
      if (!active || !restored) return;
      const me = await api.me();
      if (!active) return;
      setResumeStep(stepForAction(me.nextAction));
      setView("profile");
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  function enterLogin(intent: LoginIntent = "new") {
    void intent;
    setStarted(false);
    setView("login");
    setMessage("");
  }

  async function sendCode() {
    if (!phoneReady) return setMessage("请输入正确的 11 位手机号码");
    if (!agreed) return setMessage("请先阅读并同意用户协议与隐私政策");
    setBusy(true);
    try {
      const challenge = await api.sendSms(normalizedPhone);
      setChallengeId(challenge.challengeId);
      setCodeSent(true);
      setMessage(`验证码已发送至 ${challenge.phoneMasked}`);
    } catch (error) {
      setMessage(apiMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!phoneReady || !agreed) return void sendCode();
    if (!codeReady) return setMessage("请输入 6 位验证码");
    if (!challengeId) return void sendCode();
    setBusy(true);
    try {
      const consentAcceptances = (bootstrap?.requiredLegalDocuments || [])
        .filter((document) => document.required)
        .map(({ documentId, version }) => ({ documentId, version }));
      const session = await api.createSession(challengeId, code, consentAcceptances);
      setMessage("登录成功");
      setResumeStep(stepForAction(session.nextAction));
      setView("profile");
    } catch (error) {
      setMessage(apiMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const legalHref = (type: "TERMS_OF_SERVICE" | "PRIVACY_POLICY") => {
    const document = bootstrap?.requiredLegalDocuments.find((item) => item.type === type);
    return document ? `/api/v1/legal-documents/${encodeURIComponent(document.documentId)}` : "#";
  };

  return (
    <main className="stage">
      <section className={`phone ${view === "login" ? "login-mode" : ""} ${view === "profile" || view === "recovery" ? "profile-mode" : ""}`} aria-label={view === "welcome" ? "身心游欢迎页" : view === "login" ? "手机号登录与注册" : view === "recovery" ? "继续未完成的生命智慧档案" : "建立生命智慧档案"}>
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />

        {view === "welcome" ? (
          <>
            <span className="screen-id">R1.0 · AUTH-02</span>
            <header className="brand-row">
              <Brand />
              <button className="quiet-link" type="button" onClick={() => enterLogin("existing")}>已有档案</button>
            </header>

            <div className="hero-copy">
              <p className="eyebrow">YOUR INNER SEASONS</p>
              <h1>每一天，<br /><em>更懂自己一点</em></h1>
              <p className="intro">从你的出生时刻出发，读懂当下的节律，找到适合自己的下一步。</p>
            </div>

            <div className="life-orbit" aria-hidden="true">
              <div className="orbit orbit-outer"><b /><b /><b /></div>
              <div className="orbit orbit-middle" />
              <div className="sun"><span>此刻</span><strong>遇见自己</strong></div>
              <span className="leaf leaf-a" /><span className="leaf leaf-b" /><span className="leaf leaf-c" />
            </div>

            <div className="bottom-panel">
              <div className="trust-note"><span className="lock" aria-hidden="true" /><span>你的出生资料默认仅自己可见，也可以随时管理</span></div>
              <button className="primary" type="button" onClick={() => setStarted(true)}>开始认识自己 <span aria-hidden="true">→</span></button>
              <p className="agreement">继续即表示你已阅读并同意 <a href={legalHref("TERMS_OF_SERVICE")} target="_blank">用户协议</a> 与 <a href={legalHref("PRIVACY_POLICY")} target="_blank">隐私政策</a></p>
            </div>

            {started && (
              <div className="sheet-backdrop" role="presentation" onClick={() => setStarted(false)}>
                <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(event) => event.stopPropagation()}>
                  <div className="sheet-handle" /><span className="sheet-icon" aria-hidden="true">✦</span>
                  <p className="eyebrow">LIFE PROFILE</p><h2 id="sheet-title">先建立你的生命智慧档案</h2>
                  <p>大约需要 1 分钟。我们会请你填写出生日期、时间和地点，用于生成属于你的每日内容。</p>
                  <button className="primary" type="button" onClick={() => enterLogin("new")}>手机号登录并建档 <span>→</span></button>
                  <button className="sheet-close" type="button" onClick={() => setStarted(false)}>稍后再说</button>
                </section>
              </div>
            )}
          </>
        ) : view === "login" ? (
          <div className="login-page">
            <span className="screen-id">R1.0 · {codeSent ? "AUTH-04" : "AUTH-03"}</span>
            <header className="login-header">
              <button className="back-button" type="button" onClick={() => setView("welcome")} aria-label="返回欢迎页">←</button>
              <Brand compact />
              <span className="header-spacer" />
            </header>

            <div className="login-symbol" aria-hidden="true"><i /><span>归</span></div>

            <div className="login-copy">
              <p className="eyebrow">WELCOME BACK</p>
              <h1>欢迎回来</h1>
              <p>一个手机号，对应一份属于你的生命智慧档案。未注册的手机号验证后将自动创建账号。</p>
            </div>

            <form className="login-form" id="AUTH-03-04" onSubmit={submit} noValidate>
              <label className="field-label" htmlFor="phone">手机号</label>
              <div className={`field ${message.includes("手机号码") ? "field-error" : ""}`}>
                <span className="country-code">+86</span><span className="field-divider" />
                <input id="phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="请输入手机号码" value={normalizedPhone} onChange={(e) => { setPhone(e.target.value); setMessage(""); }} />
              </div>

              <div className="code-title-row">
                <label className="field-label" htmlFor="code">验证码</label>
                {codeSent && <span className="sent-hint">已发送至 {normalizedPhone.slice(0,3)}****{normalizedPhone.slice(-4)}</span>}
              </div>
              <div className="field code-field">
                <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6 位验证码" maxLength={6} value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0,6)); setMessage(""); }} />
                <button type="button" className="send-code" onClick={sendCode} disabled={busy}>{busy ? "发送中" : codeSent ? "重新发送" : "获取验证码"}</button>
              </div>

              <label className="consent-row">
                <input type="checkbox" checked={agreed} onChange={(e) => { setAgreed(e.target.checked); setMessage(""); }} />
                <span className="checkmark" aria-hidden="true">✓</span>
                <span>我已阅读并同意 <a href={legalHref("TERMS_OF_SERVICE")} target="_blank">用户协议</a>、<a href={legalHref("PRIVACY_POLICY")} target="_blank">隐私政策</a>，并知晓出生资料的用途</span>
              </label>
              <span className="rule-id">AUTH-05 · 协议与隐私确认</span>

              <div className={`form-message ${message.startsWith("登录成功") ? "success" : ""}`} aria-live="polite">{message || "验证码仅用于身份验证，我们不会用它向你营销"}</div>

              <button className="primary login-submit" type="submit" disabled={!phoneReady || !codeReady || !agreed || busy}>{busy ? "登录中…" : "登录 / 注册"} <span>→</span></button>
            </form>

            <div className="login-footer"><span className="lock" aria-hidden="true" />账号与生命智慧档案会安全绑定，不会公开展示手机号</div>
          </div>
        ) : view === "recovery" ? (
          <ProfileRecovery onBack={() => setView("login")} onContinue={() => { setResumeStep(3); setView("profile"); }} onRestart={() => { setResumeStep(0); setView("profile"); }} />
        ) : (
          <ProfileFlow onExit={() => setView("login")} onLogout={() => setView("welcome")} initialStep={resumeStep} />
        )}
      </section>
    </main>
  );
}

type ProfileData = { name: string; date: string; time: string; accuracy: string; place: string; locationId: string; gender: "MALE" | "FEMALE"; relationshipType: "FAMILY" | "FRIEND" | "COLLEAGUE" | "OTHER" };
const profileSteps = ["PROFILE-01", "PROFILE-02", "PROFILE-03", "PROFILE-04", "PROFILE-05", "PROFILE-07", "PROFILE-08", "PROFILE-10", "PROFILE-11", "GIFT-01", "HOME-01", "DAILY-01", "PAY-01", "DAILY-02", "DAILY-03", "DAILY-04", "DAILY-05", "SHARE-01", "SHARE-02", "SHARE-03", "SHARE-04", "MY-01", "MY-02", "MY-03", "MY-04", "MY-05", "MY-06", "MY-07", "MY-08", "READ-01", "READ-02", "READ-03", "READ-04", "READ-05", "READ-06", "READ-09", "READ-10", "READ-11", "READ-12", "READ-13", "READ-14", "READ-15", "READ-18", "GRW-01", "REL-01", "READ-19", "READ-20", "READ-21", "READ-22", "READ-23", "READ-24", "READ-25", "GRW-02", "GRW-03", "GRW-06", "LIFE-01", "PER-01", "PER-03", "PER-14", "LIFE-02", "LIFE-03", "LIFE-04", "LIFE-05", "LIFE-06", "LIFE-07", "LIFE-08", "PER-04", "PER-05", "PER-06", "PER-07", "PER-08", "PER-09", "PER-10", "PER-11", "PER-12", "PER-13", "PER-35", "PER-36", "PER-37", "PER-38", "PER-39", "PER-40", "PER-15", "PER-16", "PER-17", "PER-18", "PER-19", "PER-20", "PER-21", "PER-22", "PER-23", "PER-24", "PER-25", "PER-26", "PER-27", "GRW-10", "GRW-11", "GRW-12", "GRW-13", "GRW-14", "GRW-15", "GRW-16", "GRW-17", "GRW-18", "GRW-19", "GRW-20", "GRW-21", "GRW-22", "GRW-23", "GRW-24", "GRW-25", "MY-09", "MY-10", "MY-11", "MY-12", "MY-13", "MY-14", "MY-15", "MY-16", "REL-02", "REL-03", "REL-04", "REL-05", "REL-06", "REL-07", "REL-08", "REL-09", "REL-10", "REL-11", "REL-12", "REL-13", "REL-14", "REL-15", "SHOP-01", "SHOP-02", "SHOP-03", "SHOP-04", "SEED-01", "SEED-02", "SEED-03", "SEED-04", "SEED-05", "SEED-06", "SEED-07", "SEED-08", "SEED-09", "GOODS-01", "GOODS-02", "GOODS-03", "GOODS-04", "GOODS-05", "GOODS-06", "GOODS-07", "GOODS-08", "GOODS-09", "GOODS-10", "ORDER-01", "ORDER-02", "ORDER-03", "ORDER-04", "ORDER-05", "PREVIEW-READ", "PREVIEW-GROWTH", "PREVIEW-RELATIONSHIP"];
const standaloneSteps = profileSteps.slice(10);
const r1StepIds = new Set([
  "PROFILE-01", "PROFILE-02", "PROFILE-03", "PROFILE-04", "PROFILE-05", "PROFILE-07", "PROFILE-08", "PROFILE-10", "PROFILE-11",
  "GIFT-01", "HOME-01", "DAILY-01", "PAY-01", "DAILY-02", "DAILY-03",
  "MY-01", "MY-02", "MY-03", "MY-04", "MY-07", "MY-08",
  "MY-09", "MY-10", "MY-11", "MY-12", "MY-13", "MY-14", "MY-16",
  "PREVIEW-READ", "PREVIEW-GROWTH", "PREVIEW-RELATIONSHIP",
]);

function ProfileFlow({ onExit, onLogout, initialStep = 0 }: { onExit: () => void; onLogout: () => void; initialStep?: number }) {
  const [step, setStep] = useState(initialStep);
  const [data, setData] = useState<ProfileData>({ name: "", date: "1990-05-18", time: "08:30", accuracy: "准确到分钟", place: "杭州", locationId: "", gender: "FEMALE", relationshipType: "OTHER" });
  const [locations, setLocations] = useState<Location[]>([]);
  const [revision, setRevision] = useState<ProfileRevision | null>(null);
  const [home, setHome] = useState<HomeOverview | null>(null);
  const [account, setAccount] = useState<WisdomSeedAccount | null>(null);
  const [transactions, setTransactions] = useState<WisdomSeedTransaction[]>([]);
  const [dailyInsight, setDailyInsight] = useState<DailyInsight | null>(null);
  const [profiles, setProfiles] = useState<LifeProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<LifeProfile | null>(null);
  const [otherRevision, setOtherRevision] = useState<ProfileRevision | null>(null);
  const [otherData, setOtherData] = useState<ProfileData>({ name: "", date: "1964-03-12", time: "06:30", accuracy: "准确到分钟", place: "杭州", locationId: "", gender: "FEMALE", relationshipType: "FAMILY" });
  const [taskId, setTaskId] = useState<string | null>(null);
  const [apiBusy, setApiBusy] = useState(false);
  const [apiError, setApiError] = useState("");
  const [relationshipType, setRelationshipType] = useState("情感伴侣");
  const [relationshipSource, setRelationshipSource] = useState<"archive" | "cards">("archive");
  const [returnAfterSeed, setReturnAfterSeed] = useState<number | null>(null);
  const id = profileSteps[step];
  const progress = Math.min(100, (step / 6) * 100);

  async function loadOverview() {
    const [homeResult, accountResult, transactionResult] = await Promise.allSettled([
      api.home(), api.seedAccount(), api.seedTransactions(),
    ]);
    if (homeResult.status === "fulfilled") {
      setHome(homeResult.value);
      setData((current) => ({ ...current, name: current.name || homeResult.value.profile.displayName }));
      if (homeResult.value.profile.currentRevisionId) {
        api.profileRevision(homeResult.value.profile.currentRevisionId).then(setRevision).catch(() => undefined);
      }
    }
    if (accountResult.status === "fulfilled") setAccount(accountResult.value);
    if (transactionResult.status === "fulfilled") setTransactions(transactionResult.value);
  }

  useEffect(() => {
    const overviewTimer = window.setTimeout(() => void loadOverview(), 0);
    if (initialStep === 5) {
      api.selfProfile().then((profile) => profile.pendingRevisionId ? api.profileRevision(profile.pendingRevisionId) : null)
        .then((pending) => pending && setRevision(pending)).catch(() => undefined);
    }
    return () => window.clearTimeout(overviewTimer);
  }, [initialStep]);

  useEffect(() => {
    const query = step === 4 ? data.place : step === 112 ? otherData.place : "";
    if (query.trim().length < 2) return;
    const timer = window.setTimeout(() => {
      api.searchLocations(query).then(setLocations).catch((error) => setApiError(apiMessage(error)));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [step, data.place, otherData.place]);

  useEffect(() => {
    if (step !== 111) return;
    api.profiles().then(setProfiles).catch((error) => setApiError(apiMessage(error)));
  }, [step]);

  useEffect(() => {
    if (!taskId || step !== 13) return;
    const timer = window.setInterval(async () => {
      try {
        const task = await api.generationTask(taskId);
        if (task.status === "READY") {
          window.clearInterval(timer);
          const insight = await api.dailyInsight(dailyInsight?.localDate || new Date().toISOString().slice(0, 10));
          setDailyInsight(insight);
          await loadOverview();
          setStep(14);
        } else if (task.status === "FAILED") {
          window.clearInterval(timer);
          setApiError(task.failure?.message || "今日指引生成失败，智慧种子会按规则退回");
        }
      } catch (error) {
        setApiError(apiMessage(error));
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [taskId, step, dailyInsight?.localDate]);

  async function previewProfile() {
    if (!data.locationId) return setApiError("请从搜索结果中选择出生地点");
    setApiBusy(true); setApiError("");
    try {
      const [year, month, day] = data.date.split("-").map(Number);
      const exact = data.accuracy === "准确到分钟" || data.accuracy === "大致时间";
      const value = await api.previewProfile({
        calendarType: "SOLAR",
        date: { year, month, day, isLeapMonth: false },
        timePrecision: data.accuracy === "准确到分钟" ? "EXACT_MINUTE" : data.accuracy === "大致时间" ? "APPROXIMATE" : "DATE_ONLY",
        time: { localTime: exact ? data.time : null, hourBranchCode: null },
        locationId: data.locationId,
        calculationGender: data.gender,
      });
      setRevision(value);
      setStep(6);
    } catch (error) { setApiError(apiMessage(error)); }
    finally { setApiBusy(false); }
  }

  async function confirmProfile() {
    if (!revision?.inputFingerprint) return setApiError("档案预览缺少校验指纹，请重新生成");
    setApiBusy(true); setApiError("");
    try {
      await api.confirmProfile(revision.revisionId, revision.inputFingerprint, Boolean(revision.requiresEnhancedConfirmation));
      await loadOverview();
      setStep(8);
    } catch (error) { setApiError(apiMessage(error)); }
    finally { setApiBusy(false); }
  }

  async function claimReward() {
    setApiBusy(true); setApiError("");
    try { const result = await api.claimRegistrationReward(); setAccount(result.account); await loadOverview(); setStep(10); }
    catch (error) { setApiError(apiMessage(error)); }
    finally { setApiBusy(false); }
  }

  async function startDailyInsight() {
    setApiBusy(true); setApiError("");
    try {
      const result = await api.createTodayInsight();
      setDailyInsight(result.dailyInsight);
      if (result.dailyInsight.status === "READY") { await loadOverview(); setStep(14); }
      else { setTaskId(result.task?.taskId || null); setStep(13); }
    } catch (error) { setApiError(apiMessage(error)); }
    finally { setApiBusy(false); }
  }

  async function createOtherProfile() {
    if (!otherData.name.trim() || !otherData.locationId) return setApiError("请填写称呼并从搜索结果选择出生地点");
    setApiBusy(true); setApiError("");
    try {
      const [year, month, day] = otherData.date.split("-").map(Number);
      const profile = await api.createProfile(otherData.name.trim(), otherData.relationshipType);
      const preview = await api.previewOtherProfile(profile.profileId, {
        calendarType: "SOLAR", date: { year, month, day, isLeapMonth: false },
        timePrecision: "EXACT_MINUTE", time: { localTime: otherData.time, hourBranchCode: null },
        locationId: otherData.locationId, calculationGender: otherData.gender,
      });
      setSelectedProfile(profile); setOtherRevision(preview); setStep(113);
    } catch (error) { setApiError(apiMessage(error)); }
    finally { setApiBusy(false); }
  }

  async function confirmOtherProfile() {
    if (!selectedProfile || !otherRevision?.inputFingerprint) return setApiError("人物档案预览尚未准备好");
    setApiBusy(true); setApiError("");
    try {
      const confirmed = await api.confirmOtherProfile(selectedProfile.profileId, otherRevision.revisionId, otherRevision.inputFingerprint, Boolean(otherRevision.requiresEnhancedConfirmation));
      setOtherRevision(confirmed); setSelectedProfile({ ...selectedProfile, state: "ACTIVE", currentRevisionId: confirmed.revisionId });
      setProfiles(await api.profiles()); setStep(114);
    } catch (error) { setApiError(apiMessage(error)); }
    finally { setApiBusy(false); }
  }

  function openOtherProfile(profile: LifeProfile) {
    setSelectedProfile(profile);
    if (profile.currentRevisionId) api.profileRevision(profile.currentRevisionId).then(setOtherRevision).catch(() => undefined);
    setStep(115);
  }

  async function deleteOtherProfile() {
    if (!selectedProfile) return;
    setApiBusy(true); setApiError("");
    try { await api.deleteProfile(selectedProfile.profileId); setProfiles(await api.profiles()); setSelectedProfile(null); setOtherRevision(null); setStep(111); }
    catch (error) { setApiError(apiMessage(error)); }
    finally { setApiBusy(false); }
  }

  async function logout() {
    setApiBusy(true); setApiError("");
    try { await api.logout(); onLogout(); }
    catch (error) { setApiError(apiMessage(error)); }
    finally { setApiBusy(false); }
  }

  function navigateR1(target: number) {
    if (r1StepIds.has(profileSteps[target])) setStep(target);
  }

  function next() {
    if (id === "PROFILE-08") return setStep(7);
    setStep((value) => Math.min(value + 1, profileSteps.length - 1));
  }

  function back() {
    if (step === 0) return onExit();
    setStep((value) => value - 1);
  }

  return (
    <div className="profile-flow">
      <span className="screen-id">R1.0 · {id}</span>
      {!standaloneSteps.includes(id) && <header className="flow-header">
        <button className="back-button" type="button" onClick={back} aria-label="返回上一步">←</button>
        <div className="flow-progress" aria-label={`建档进度 ${Math.round(progress)}%`}><i style={{ width: `${progress}%` }} /></div>
        <button className="save-exit" type="button" onClick={onExit}>保存退出</button>
      </header>}
      {apiError && <div className="form-message" role="alert">{apiError}</div>}

      {id === "PROFILE-01" && <ProfileIntro onNext={next} />}
      {id === "PROFILE-02" && (
        <FlowStep eyebrow="ABOUT YOU" title="希望我们怎么称呼你？" note="这个称呼会出现在你的日签与报告中，之后可以随时修改。">
          <label className="field-label" htmlFor="nickname">你的称呼</label>
          <div className="field profile-field"><input id="nickname" autoFocus maxLength={16} placeholder="例如：小满" value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} /></div>
          <p className="input-helper">不需要填写真实姓名，1—16 个字符</p>
          <FlowNext onClick={next} disabled={!data.name.trim()}>继续</FlowNext>
        </FlowStep>
      )}
      {id === "PROFILE-03" && (
        <FlowStep eyebrow="BIRTH DATE" title={`${data.name || "你"}，你的出生日期是？`} note="首版使用公历日期。接近节气边界时，系统会结合具体时间与地点计算。">
          <label className="field-label" htmlFor="birth-date">公历出生日期</label>
          <div className="field profile-field"><input id="birth-date" type="date" value={data.date} max="2026-08-06" onChange={(e) => setData({ ...data, date: e.target.value })} /></div>
          <label className="field-label">计算性别</label>
          <div className="choice-grid">
            {([["FEMALE", "女"], ["MALE", "男"]] as const).map(([value, label]) => <button key={value} type="button" className={data.gender === value ? "choice active" : "choice"} onClick={() => setData({ ...data, gender: value })}><i />{label}<span>用于传统排盘规则计算</span></button>)}
          </div>
          <div className="soft-card"><span>历</span><p><strong>为什么需要日期？</strong>它是建立生命智慧档案的基础，不会出现在公开分享中。</p></div>
          <FlowNext onClick={next} disabled={!data.date}>继续</FlowNext>
        </FlowStep>
      )}
      {id === "PROFILE-04" && (
        <FlowStep eyebrow="BIRTH TIME" title="你知道出生时间吗？" note="不知道也没关系。诚实的不确定，比看起来精确更重要。">
          <div className="choice-grid">
            {["准确到分钟", "大致时间", "只知道时辰", "完全不知道"].map((item) => <button key={item} type="button" className={data.accuracy === item ? "choice active" : "choice"} onClick={() => setData({ ...data, accuracy: item })}><i />{item}<span>{item === "准确到分钟" ? "推荐保留原始分钟" : item === "大致时间" ? "可以填写误差范围" : item === "只知道时辰" ? "按传统时辰保存" : "建立时间不完整档案"}</span></button>)}
          </div>
          {data.accuracy === "准确到分钟" && <div className="field profile-field time-input"><input aria-label="出生时间" type="time" value={data.time} onChange={(e) => setData({ ...data, time: e.target.value })} /></div>}
          <FlowNext onClick={next}>继续</FlowNext>
        </FlowStep>
      )}
      {id === "PROFILE-05" && (
        <FlowStep eyebrow="BIRTH PLACE" title="你出生在哪里？" note="出生地点用于确认当地时区与时间规则，不需要开启当前定位。">
          <label className="field-label" htmlFor="birth-place">搜索城市或区县</label>
          <div className="field profile-field place-field"><span>⌖</span><input id="birth-place" placeholder="城市、区县或国家" value={data.place} onChange={(e) => setData({ ...data, place: e.target.value, locationId: "" })} /></div>
          {locations.map((location) => <button className="place-result" type="button" key={location.locationId} onClick={() => setData({ ...data, place: location.displayName, locationId: location.locationId })}><span className="place-pin">{location.displayName.slice(0, 1)}</span><span><strong>{location.displayName}</strong><small>{location.administrativePath.join(" · ")} · {location.timezone}</small></span><b>{data.locationId === location.locationId ? "✓" : "选择"}</b></button>)}
          <p className="input-helper">搜索不到出生地？<a href="#">提交地点反馈</a></p>
          <FlowNext onClick={next} disabled={!data.locationId}>继续</FlowNext>
        </FlowStep>
      )}
      {id === "PROFILE-07" && (
        <FlowStep eyebrow="PLEASE CONFIRM" title="确认你的出生资料" note="确认后会创建一个可追溯的资料版本。以后修改时，历史报告仍保留原来的依据。">
          <div className="summary-card">
            <SummaryRow label="称呼" value={data.name} edit={() => setStep(1)} />
            <SummaryRow label="出生日期" value={`${data.date} · 公历`} edit={() => setStep(2)} />
            <SummaryRow label="计算性别" value={data.gender === "FEMALE" ? "女" : "男"} edit={() => setStep(2)} />
            <SummaryRow label="出生时间" value={`${data.time} · ${data.accuracy}`} edit={() => setStep(3)} />
            <SummaryRow label="出生地点" value={data.place} edit={() => setStep(4)} />
            <SummaryRow label="时间规则" value="将根据地点、时区与已确认规则处理" />
          </div>
          <div className="privacy-inline"><span className="lock" /><p>仅用于生成你的个人内容，默认仅你自己可见。<a href="#">查看数据用途</a></p></div>
          <FlowNext onClick={previewProfile} disabled={apiBusy}>{apiBusy ? "正在计算…" : "确认并生成生命智慧档案"}</FlowNext>
        </FlowStep>
      )}
      {id === "PROFILE-08" && <Calculating name={data.name} onDone={next} />}
      {id === "PROFILE-10" && <ProfileResult name={data.name} revision={revision} onNext={confirmProfile} onRestart={() => setStep(0)} busy={apiBusy} />}
      {id === "PROFILE-11" && <RelationshipFirstLook name={data.name} revision={revision} onNext={next} />}
      {id === "GIFT-01" && <SeedGift name={data.name} claimed={home?.registrationReward.status === "CLAIMED"} busy={apiBusy} onClaim={claimReward} onNext={() => setStep(10)} />}
      {id === "HOME-01" && <TodayHome name={data.name || home?.profile.displayName || "你"} home={home} onNext={() => home?.dailyInsight.state === "READY" && home.dailyInsight.localDate ? api.dailyInsight(home.dailyInsight.localDate).then((value) => { setDailyInsight(value); setStep(14); }).catch((error) => setApiError(apiMessage(error))) : setStep(11)} navigate={navigateR1} />}
      {id === "DAILY-01" && <DailyStart name={data.name} onBack={back} onNext={next} />}
      {id === "PAY-01" && <SeedPayment balance={account?.available || 0} busy={apiBusy} onBack={back} onNext={startDailyInsight} />}
      {id === "DAILY-02" && <DailyGenerating name={data.name} balance={account?.available || 0} onBack={back} />}
      {id === "DAILY-03" && <DailyReport name={data.name} insight={dailyInsight} balance={account?.available || 0} onBack={back} onNext={() => setStep(10)} />}
      {id === "DAILY-04" && <DailyAction onBack={back} onNext={next} />}
      {id === "DAILY-05" && <DailyShare name={data.name} onBack={back} onGenerate={next} onHome={() => setStep(10)} />}
      {id === "SHARE-01" && <ShareOptions onBack={back} onNext={next} />}
      {id === "SHARE-02" && <ShareGenerating onBack={back} onSuccess={next} onFailure={() => setStep(20)} />}
      {id === "SHARE-03" && <ShareSuccess onBack={back} onHome={() => setStep(10)} />}
      {id === "SHARE-04" && <ShareFailure onBack={back} onRetry={() => setStep(18)} onHome={() => setStep(10)} />}
      {id === "MY-01" && <MyHome name={data.name} balance={account?.available || 0} open={navigateR1} />}
      {id === "MY-02" && <MyProfile home={home} revision={revision} onBack={() => setStep(21)} />}
      {id === "MY-03" && <MySeeds account={account} transactions={transactions} onBack={() => setStep(21)} />}
      {id === "MY-04" && <MyReports home={home} insight={dailyInsight} onBack={() => setStep(21)} onDaily={() => home?.dailyInsight.localDate ? api.dailyInsight(home.dailyInsight.localDate).then((value) => { setDailyInsight(value); setStep(14); }).catch((error) => setApiError(apiMessage(error))) : undefined} />}
      {id === "MY-05" && <MyBenefits onBack={() => setStep(21)} openShop={() => setStep(133)} openOrders={() => setStep(156)} />}
      {id === "MY-06" && <MyStudyCompanion onBack={() => setStep(21)} />}
      {id === "MY-07" && <MySettings onBack={() => setStep(21)} onLogout={logout} busy={apiBusy} />}
      {id === "MY-08" && <MySupport onBack={() => setStep(21)} />}
      {id === "MY-09" && <WisdomArchive profiles={profiles} self={home?.profile || null} onBack={() => setStep(21)} onAdd={() => setStep(112)} onSelf={() => setStep(22)} onPerson={openOtherProfile} />}
      {id === "MY-10" && <NewPersonArchive data={otherData} locations={locations} busy={apiBusy} onChange={setOtherData} onBack={() => setStep(111)} onNext={createOtherProfile} />}
      {id === "MY-11" && <ArchiveConfirm data={otherData} revision={otherRevision} busy={apiBusy} onBack={back} onNext={confirmOtherProfile} />}
      {id === "MY-12" && <ArchiveGenerating name={selectedProfile?.displayName || otherData.name} onBack={() => setStep(111)} onNext={next} />}
      {id === "MY-13" && <PersonArchive profile={selectedProfile} revision={otherRevision} onBack={() => setStep(111)} onManage={next} />}
      {id === "MY-14" && <PersonArchiveManage profile={selectedProfile} onBack={back} onDelete={() => setStep(118)} />}
      {id === "MY-15" && <ArchivePicker onBack={() => setStep(111)} onAdd={() => setStep(112)} onNext={() => setStep(44)} />}
      {id === "MY-16" && <ArchiveDeleteImpact name={selectedProfile?.displayName || "这份人物档案"} busy={apiBusy} onBack={() => setStep(116)} onDone={deleteOtherProfile} />}
      {id === "PREVIEW-READ" && <ComingSoonPage kind="问事" navigate={navigateR1} />}
      {id === "PREVIEW-GROWTH" && <ComingSoonPage kind="成长" navigate={navigateR1} />}
      {id === "PREVIEW-RELATIONSHIP" && <ComingSoonPage kind="关系" navigate={navigateR1} />}
      {id === "REL-02" && <RelationshipDimension initialType={relationshipType} onBack={() => setStep(121)} onNext={(type) => { setRelationshipType(type); setStep(121); }} />}
      {id === "REL-03" && <RelationshipHistory onBack={() => setStep(44)} onOpen={(type) => { setRelationshipType(type); setStep(129); }} />}
      {id === "REL-04" && <RelationshipSource type={relationshipType} onBack={() => setStep(44)} onDimension={() => setStep(119)} onArchive={() => { setRelationshipSource("archive"); setStep(122); }} onCards={() => { setRelationshipSource("cards"); setStep(123); }} />}
      {id === "REL-05" && <RelationshipArchivePick onBack={back} onAdd={() => setStep(112)} onNext={() => setStep(125)} />}
      {id === "REL-06" && <RelationshipCardInput who="人物 A" name="小满" onBack={() => setStep(121)} onNext={next} />}
      {id === "REL-07" && <RelationshipCardInput who="人物 B" name="周言" onBack={back} onNext={() => setStep(125)} />}
      {id === "REL-08" && <RelationshipConfirm type={relationshipType} onBack={() => setStep(relationshipSource === "archive" ? 122 : 124)} onNext={next} />}
      {id === "REL-09" && <RelationshipPrivacy onBack={back} onNext={next} />}
      {id === "REL-10" && <RelationshipPayment type={relationshipType} onBack={back} onNext={next} />}
      {id === "REL-11" && <RelationshipGenerating onBack={() => setStep(44)} onNext={next} />}
      {id === "REL-12" && <RelationshipSummary type={relationshipType} onBack={() => setStep(44)} onFull={next} onShare={() => setStep(131)} />}
      {id === "REL-13" && <RelationshipFullReport type={relationshipType} onBack={back} onShare={next} onDone={() => setStep(132)} />}
      {id === "REL-14" && <RelationshipShare onBack={() => setStep(129)} onDone={next} />}
      {id === "REL-15" && <RelationshipComplete onHome={() => setStep(44)} onHistory={() => setStep(120)} />}
      {/^(SHOP|SEED|GOODS|ORDER)-/.test(id) && <CommercePage id={id} navigate={setStep} returnAfterSeed={returnAfterSeed} onReturnAfterSeed={() => { if (returnAfterSeed !== null) setStep(returnAfterSeed); setReturnAfterSeed(null); }} onSeedRecharge={(target) => { setReturnAfterSeed(target); setStep(137); }} />}
      {id === "READ-01" && <ReadingHome navigate={setStep} onNext={next} onHistory={() => setStep(45)} />}
      {id === "READ-02" && <ReadingQuestion onBack={back} onNext={next} />}
      {id === "READ-03" && <ReadingConfirm onBack={back} onNext={() => setStep(33)} onSafety={() => setStep(32)} />}
      {id === "READ-04" && <ReadingSafety onBack={back} onContinue={() => setStep(33)} onRewrite={() => setStep(30)} />}
      {id === "READ-05" && <ReadingSpread onBack={() => setStep(31)} onNext={next} />}
      {id === "READ-06" && <ReadingConfig onBack={back} onNext={next} />}
      {id === "READ-09" && <ReadingPayment onBack={back} onNext={next} onInsufficient={() => setStep(46)} />}
      {id === "READ-10" && <ReadingShuffle onBack={back} onNext={next} />}
      {id === "READ-11" && <ReadingDraw onBack={back} onNext={next} />}
      {id === "READ-12" && <ReadingReveal onBack={back} onNext={next} />}
      {id === "READ-13" && <ReadingGenerate onBack={back} onSuccess={() => setStep(41)} onFailure={() => setStep(40)} onLeave={() => setStep(47)} onNetworkError={() => setStep(51)} />}
      {id === "READ-14" && <ReadingFailure onBack={back} onRetry={() => setStep(39)} />}
      {id === "READ-15" && <ReadingReport onBack={() => setStep(38)} onNext={next} />}
      {id === "READ-18" && <ReadingFeedback onBack={() => setStep(41)} onHome={() => setStep(29)} onShare={() => setStep(48)} />}
      {id === "GRW-01" && <GrowthHome name={data.name} navigate={setStep} />}
      {id === "REL-01" && <RelationshipHome navigate={setStep} onStart={(type) => { setRelationshipType(type); setStep(121); }} onHistory={() => setStep(120)} />}
      {id === "READ-19" && <ReadingHistory onBack={() => setStep(29)} onOpen={() => setStep(41)} navigate={setStep} />}
      {id === "READ-20" && <ReadingInsufficient onBack={() => setStep(35)} onRecharge={() => { setReturnAfterSeed(35); setStep(137); }} onUseSingle={() => setStep(35)} />}
      {id === "READ-21" && <ReadingMessageReturn onBack={() => setStep(29)} onOpen={() => setStep(41)} />}
      {id === "READ-22" && <ReadingShareOptions onBack={() => setStep(42)} onNext={() => setStep(49)} />}
      {id === "READ-23" && <ReadingShareGenerating onBack={() => setStep(48)} onSuccess={() => setStep(50)} onFailure={() => setStep(51)} />}
      {id === "READ-24" && <ReadingShareSuccess onBack={() => setStep(48)} onHome={() => setStep(29)} />}
      {id === "READ-25" && <ReadingNetworkError onBack={() => setStep(29)} onRetry={() => setStep(39)} />}
      {id === "GRW-02" && <GrowthEmpty onBack={() => setStep(43)} onLife={() => setStep(55)} />}
      {id === "GRW-03" && <GrowthLibrary onBack={() => setStep(43)} onOpen={() => setStep(54)} />}
      {id === "GRW-06" && <GrowthReportSummary onBack={() => setStep(53)} onRead={() => setStep(41)} onAction={() => setStep(101)} />}
      {id === "LIFE-01" && <LifeLightIntro onBack={() => setStep(43)} onNext={() => setStep(59)} />}
      {id === "PER-01" && <PeriodHub onBack={() => setStep(43)} onMonthly={() => setStep(57)} onAnnual={() => setStep(58)} onHistory={() => setStep(53)} />}
      {id === "PER-03" && <MonthlyProducts onBack={() => setStep(56)} onNext={() => setStep(66)} />}
      {id === "PER-14" && <AnnualIntro onBack={() => setStep(56)} onNext={() => setStep(82)} />}
      {id === "LIFE-02" && <LifeArchiveConfirm onBack={() => setStep(55)} onNext={next} onDetails={() => setStep(22)} onEdit={() => setStep(1)} />}
      {id === "LIFE-03" && <LifeDeliveryPreview onBack={back} onNext={next} />}
      {id === "LIFE-04" && <LifeSeedConfirm onBack={back} onNext={next} />}
      {id === "LIFE-05" && <LifeGenerating onBack={back} onNext={next} onLeave={() => setStep(43)} />}
      {id === "LIFE-06" && <LifeSummary onBack={() => setStep(43)} onNext={next} />}
      {id === "LIFE-07" && <LifeFullReport onBack={back} onNext={next} />}
      {id === "LIFE-08" && <LifeShare onBack={back} onHome={() => setStep(43)} />}
      {id === "PER-04" && <MonthlyIntro onBack={() => setStep(57)} onNext={next} />}
      {id === "PER-05" && <MonthlyArchive onBack={back} onNext={next} />}
      {id === "PER-06" && <MonthlyPeriod onBack={back} onNext={next} />}
      {id === "PER-07" && <MonthlyPayment onBack={back} onNext={next} onBundle={() => setStep(81)} />}
      {id === "PER-08" && <MonthlyGenerating onBack={back} onNext={next} />}
      {id === "PER-09" && <MonthlyCenter onBack={() => setStep(56)} openOverall={() => setStep(72)} openSpecial={(i) => setStep(76+i)} onBundle={() => setStep(81)} />}
      {id === "PER-10" && <MonthlySummary onBack={() => setStep(71)} onNext={next} />}
      {id === "PER-11" && <MonthlyFullReport onBack={back} onNext={next} />}
      {id === "PER-12" && <MonthlyActions onBack={back} onNext={next} />}
      {id === "PER-13" && <MonthlyReview onBack={back} onHome={() => setStep(43)} />}
      {id === "PER-35" && <MonthlySpecial type="健康与身心关照" tone="康" onBack={() => setStep(71)} />}
      {id === "PER-36" && <MonthlySpecial type="财富与资源" tone="财" onBack={() => setStep(71)} />}
      {id === "PER-37" && <MonthlySpecial type="情感与关系" tone="情" onBack={() => setStep(71)} />}
      {id === "PER-38" && <MonthlySpecial type="个人状态" tone="心" onBack={() => setStep(71)} />}
      {id === "PER-39" && <MonthlySpecial type="事业与推进" tone="业" onBack={() => setStep(71)} />}
      {id === "PER-40" && <MonthlyBundle onBack={() => setStep(71)} onNext={() => setStep(69)} />}
      {id === "PER-15" && <AnnualArchive onBack={() => setStep(58)} onNext={next} />}
      {id === "PER-16" && <AnnualPeriod onBack={back} onNext={next} />}
      {id === "PER-17" && <AnnualPayment onBack={back} onNext={next} />}
      {id === "PER-18" && <AnnualGenerating onBack={back} onNext={next} onLeave={() => setStep(43)} />}
      {id === "PER-19" && <AnnualSummary onBack={() => setStep(56)} onMap={() => setStep(87)} onFull={() => setStep(88)} onDimensions={() => setStep(89)} onReview={() => setStep(94)} />}
      {id === "PER-20" && <AnnualMap onBack={() => setStep(86)} onMonth={() => setStep(90)} />}
      {id === "PER-21" && <AnnualFullReport onBack={() => setStep(86)} onNext={() => setStep(92)} />}
      {id === "PER-22" && <AnnualDimensions onBack={() => setStep(86)} />}
      {id === "PER-23" && <AnnualMonthDetail onBack={() => setStep(87)} onNext={next} />}
      {id === "PER-24" && <AnnualToMonthly onBack={back} onNext={() => setStep(57)} />}
      {id === "PER-25" && <AnnualActions onBack={() => setStep(88)} onNext={next} />}
      {id === "PER-26" && <AnnualReview kind="年中" onBack={back} onHome={() => setStep(86)} />}
      {id === "PER-27" && <AnnualReview kind="年末" onBack={() => setStep(86)} onHome={() => setStep(43)} />}
      {id === "GRW-10" && <GrowthTasks onBack={() => setStep(43)} onOpen={() => setStep(71)} />}
      {id === "GRW-11" && <GrowthTimeline onBack={() => setStep(43)} onFilter={() => setStep(97)} onEvent={() => setStep(98)} onRecord={() => setStep(99)} onManage={() => setStep(100)} onActions={() => setStep(101)} onReview={() => setStep(106)} />}
      {id === "GRW-12" && <TimelineFilter onBack={() => setStep(96)} />}
      {id === "GRW-13" && <GrowthEventDetail onBack={() => setStep(96)} />}
      {id === "GRW-14" && <GrowthRecord onBack={() => setStep(96)} onSave={() => setStep(96)} />}
      {id === "GRW-15" && <TimelineManage onBack={() => setStep(96)} />}
      {id === "GRW-16" && <GrowthActions onBack={() => setStep(96)} onAdopt={() => setStep(102)} onDetail={() => setStep(104)} />}
      {id === "GRW-17" && <AdoptAction onBack={() => setStep(101)} onNext={next} />}
      {id === "GRW-18" && <EditAction onBack={() => setStep(102)} onNext={next} />}
      {id === "GRW-19" && <ActionDetail onBack={() => setStep(101)} onResult={next} />}
      {id === "GRW-20" && <ActionResult onBack={back} onSave={() => setStep(96)} />}
      {id === "GRW-21" && <StageReviewStart onBack={() => setStep(96)} onNext={next} />}
      {id === "GRW-22" && <ReviewMaterials onBack={back} onNext={next} />}
      {id === "GRW-23" && <ReviewCandidate onBack={back} onNext={next} />}
      {id === "GRW-24" && <ReviewConfirm onBack={back} onNext={next} />}
      {id === "GRW-25" && <StageReviewReport onBack={back} onHome={() => setStep(43)} />}
    </div>
  );
}

function ProfileRecovery({ onBack, onContinue, onRestart }: { onBack: () => void; onContinue: () => void; onRestart: () => void }) {
  return <section className="profile-recovery">
    <span className="screen-id">R1.0 · AUTH-08</span>
    <header className="recovery-header"><button className="back-button" type="button" onClick={onBack} aria-label="返回登录页">←</button><Brand compact /><span /></header>
    <div className="remembered-life" aria-hidden="true"><div className="saved-seed"><i /><i /></div><span className="memory-ring ring-a" /><span className="memory-ring ring-b" /></div>
    <p className="eyebrow">WELCOME BACK</p>
    <h1>欢迎回来，小满</h1>
    <p className="recovery-lead">我们为你保留了上次填写的内容，不需要重新开始。</p>
    <div className="recovery-card">
      <div className="recovery-progress"><span>生命智慧档案</span><strong>已完成 3 / 5</strong></div>
      <div className="progress-track"><i /></div>
      <div className="saved-items"><span className="done">✓<small>称呼</small></span><b /><span className="done">✓<small>日期</small></span><b /><span className="current">时<small>出生时间</small></span><b /><span>地<small>出生地点</small></span><b /><span>成<small>确认生成</small></span></div>
      <p><i>●</i><span><small>将从这里继续</small><strong>出生时间与准确度</strong></span></p>
    </div>
    <div className="saved-note"><span className="lock" /><p><strong>资料已安全保存</strong>上次更新于今天 08:42，仅你自己可见。</p></div>
    <button className="primary" type="button" onClick={onContinue}>继续建立生命智慧档案 <span>→</span></button>
    <button className="restart-link" type="button" onClick={onRestart}>重新开始</button>
    <button className="leave-link" type="button" onClick={onBack}>暂时退出</button>
  </section>;
}

function ProfileIntro({ onNext }: { onNext: () => void }) {
  return <div className="profile-intro"><div className="profile-seal" aria-hidden="true"><span>生</span><i /></div><p className="eyebrow">YOUR LIFE PROFILE</p><h1>建立你的<br /><em>生命智慧档案</em></h1><p className="profile-lead">它不是给你贴标签，而是一份陪伴日签、问事、关系与成长报告持续更新的个人起点。</p><div className="benefit-list"><span><b>01</b>需要出生日期、时间和地点</span><span><b>02</b>整个过程会自动保存</span><span><b>03</b>资料默认仅自己可见，可随时管理</span></div><FlowNext onClick={onNext}>开始建立</FlowNext></div>;
}

function FlowStep({ eyebrow, title, note, children }: { eyebrow: string; title: string; note: string; children: React.ReactNode }) {
  return <section className="flow-step"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="flow-note">{note}</p><div className="flow-body">{children}</div></section>;
}

function FlowNext({ children, onClick, disabled = false }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button className="primary flow-next" type="button" disabled={disabled} onClick={onClick}>{children}<span>→</span></button>;
}

function SummaryRow({ label, value, edit }: { label: string; value: string; edit?: () => void }) {
  return <div className="summary-row"><span>{label}</span><strong>{value}</strong>{edit ? <button type="button" onClick={edit}>修改</button> : <i />}</div>;
}

function Calculating({ name, onDone }: { name: string; onDone: () => void }) {
  return <div className="calculating"><div className="calc-orbit"><i /><i /><span>四柱</span></div><p className="eyebrow">CREATING YOUR PROFILE</p><h1>正在为{name}<br />建立生命智慧档案</h1><div className="calc-stages"><span className="done">✓ 校验出生地点与时间</span><span className="done">✓ 应用时间规则</span><span className="done">✓ 计算四柱与基础结构</span><span className="active">· 准备你的档案摘要</span></div><p>计算已经完成，请确认预览结果。</p><button className="text-action" type="button" onClick={onDone}>查看计算结果 →</button></div>;
}

function ProfileResult({ name, revision, onNext, onRestart, busy }: { name: string; revision: ProfileRevision | null; onNext: () => void; onRestart: () => void; busy: boolean }) {
  const tones = ["sunset", "forest", "water", "earth"];
  const cards = (revision?.cards || []).map((card, index) => ({ title: card.title, mark: card.cardCode, tone: tones[index % tones.length] }));
  return <div className="profile-result"><span className="result-spark">✦</span><p className="eyebrow">PROFILE PREVIEW</p><h1>{name}，你的生命智慧档案<br /><em>已经算好</em></h1><p>四张关系卡牌，是你理解自己、关系与成长节律的共同起点。</p><div className="wisdom-card-panel"><small>生命智慧档案 · V{revision?.revisionNumber || 1}</small><div className="wisdom-card-grid">{cards.map((card) => <article className={`wisdom-card ${card.tone}`} key={card.title}><i aria-hidden="true" /><span>{card.title}</span><strong>{card.mark}</strong><small>关系 · 智慧</small></article>)}</div>{revision?.warnings?.map((warning) => <p key={warning}>{warning}</p>)}</div><button className="primary" type="button" onClick={onNext} disabled={busy}>{busy ? "正在确认…" : "确认档案并读懂四张卡牌"} <span>→</span></button><button className="text-action" type="button" onClick={onRestart}>重新填写出生资料</button></div>;
}

function RelationshipFirstLook({ name, revision, onNext }: { name: string; revision: ProfileRevision | null; onNext: () => void }) {
  const insights = (revision?.cards || []).map((card) => [card.title, card.cardCode, card.summary]);
  return <section className="first-look">
    <p className="eyebrow">YOUR INNER SEASONS</p>
    <h1>{name}，先感受一下<br /><em>你的生命底色</em></h1>
    <div className="season-summary">
      <div className="season-orbit" aria-hidden="true"><i /><i /><i /><i /><span>夏</span></div>
      <div><small>四季能量 · 五行气质</small><h2>生于盛夏，火意明亮<br />土的力量让你落地</h2><p>你有向外照亮的热情，也有把想法变成现实的耐力。真正适合你的，不是一味用力，而是在热烈与安定之间找到自己的节奏。</p></div>
    </div>
    <div className="insight-list">{insights.map(([title, mark, sentence], index) => <article key={title}><b>{String(index + 1).padStart(2, "0")}</b><div><small>{title} · {mark}</small><p>{sentence}</p></div></article>)}</div>
    <div className="growth-hint"><span className="seed-mini" aria-hidden="true">●</span><p><strong>一颗智慧种子，是一次向内生长的机会</strong>下一步，收下为你准备的新手启程礼。</p></div>
    <FlowNext onClick={onNext}>领取我的新手智慧种子</FlowNext>
  </section>;
}

function SeedGift({ name, claimed = false, busy, onClaim, onNext }: { name: string; claimed?: boolean; busy: boolean; onClaim: () => void; onNext: () => void }) {
  return <section className={`seed-gift ${claimed ? "claimed" : ""}`}>
    <p className="eyebrow">A GIFT FOR YOUR JOURNEY</p>
    <h1>{claimed ? `${name}，种子已入袋` : `送给${name}的第一袋智慧种子`}</h1>
    <div className="seed-visual" aria-hidden="true"><div className="soil" /><div className="sprout"><i /><i /></div><span>3</span><small>智慧种子</small></div>
    <p className="gift-lead">{claimed ? "从今天开始，让每一次指引都成为一次生长。" : "完成生命智慧档案的新用户，都可以领取一份启程礼。"}</p>
    <div className="seed-value"><span>新手启程礼</span><strong>3 颗</strong><span>智慧种子</span></div>
    <div className="growth-path" aria-label="智慧种子的成长路径"><span className="active"><i>●</i>种下</span><b /><span><i>♧</i>发芽</span><b /><span><i>❧</i>枝叶</span><b /><span><i>✦</i>结果</span></div>
    <p className="seed-rule">智慧种子是身心游全域统一的价值凭证，可用于日签、问事、关系与成长报告。</p>
    {!claimed ? <button className="primary" type="button" disabled={busy} onClick={onClaim}>{busy ? "领取中…" : "收下 3 颗智慧种子"} <span>＋</span></button> : <button className="primary" type="button" onClick={onNext}>进入今日首页 <span>→</span></button>}
  </section>;
}

function TodayHome({ name, home, onNext, navigate }: { name: string; home: HomeOverview | null; onNext: () => void; navigate: (step: number) => void }) {
  const ready = home?.dailyInsight.state === "READY";
  return <section className="today-home"><div className="life-growth" aria-hidden="true"><i className="living-seed" /><i className="living-stem" /><i className="living-leaf leaf-left" /><i className="living-leaf leaf-right" /><i className="living-leaf leaf-top" /><span className="growth-ring ring-one" /><span className="growth-ring ring-two" /></div><header><Brand compact /><div className="seed-balance"><i>●</i><span>智慧种子</span><strong>{home?.wisdomSeedAccount.available ?? "—"}</strong></div></header><p className="eyebrow">TODAY · {home?.dailyInsight.localDate || new Date().toLocaleDateString("zh-CN")}</p><h1>{name}，你好</h1><p className="home-note">今天不必急着证明什么，先让自己的节奏回来。</p><article className="daily-guide"><small>今日能量指引</small><div className="daily-sun"><span>{ready ? "成" : "中"}</span><small>{ready ? "已生成" : "今日能量"}</small></div><h2>{ready ? "今天的专属指引已经准备好" : "把重要的事放在心静之后"}</h2><p>{ready ? "可以随时回来阅读，不会再次消耗智慧种子。" : "用 1 颗智慧种子，生成属于你的完整今日指引。"}</p><button type="button" onClick={onNext}>{ready ? "查看今日指引" : "开启今日指引"} <span>{ready ? "→" : "1 ●"}</span></button></article><MainNav active="今日" navigate={navigate} /></section>;
}

function DailyHeader({ onBack, balance = 3 }: { onBack: () => void; balance?: number }) {
  return <header className="daily-header"><button className="back-button" type="button" onClick={onBack} aria-label="返回上一页">←</button><Brand compact /><div className="mini-balance"><i>●</i>{balance}</div></header>;
}

function DailyStart({ name, onBack, onNext }: { name: string; onBack: () => void; onNext: () => void }) {
  return <section className="daily-page daily-start"><DailyHeader onBack={onBack} /><div className="daily-seed-scene" aria-hidden="true"><i /><span>中</span><b>今日能量</b></div><p className="eyebrow">DAILY GUIDANCE</p><h1>{name}，今天的能量<br />正在邀请你慢下来</h1><p className="daily-lead">结合你的生命智慧档案与今日节律，为你整理一份只属于今天的行动指引。</p><div className="will-get"><small>你将获得</small><span><b>01</b>今日整体能量</span><span><b>02</b>事业与外部节奏</span><span><b>03</b>情绪与个人状态</span><span><b>04</b>一个可完成的小行动</span></div><div className="cost-preview"><span><i>●</i><small>本次需要</small></span><strong>1 颗智慧种子</strong></div><button className="primary" type="button" onClick={onNext}>继续开启 <span>→</span></button></section>;
}

function SeedPayment({ balance, busy, onBack, onNext }: { balance: number; busy: boolean; onBack: () => void; onNext: () => void }) {
  return <section className="daily-page seed-payment"><DailyHeader onBack={onBack} balance={balance} /><p className="eyebrow">PLANT A SEED</p><h1>种下一颗智慧种子</h1><p className="daily-lead">每一次使用，都是为一次更清晰的看见投入能量。</p><div className="pay-seed" aria-hidden="true"><i /><span>●</span><small>智慧种子</small></div><div className="payment-card"><div><span>今日能量指引</span><strong>1 颗</strong></div><div><span>当前余额</span><strong>{balance} 颗</strong></div><div className="after"><span>完成后余额</span><strong>{Math.max(0, balance - 1)} 颗</strong></div></div><p className="payment-note"><span className="lock" />确认后将立即生成，生成失败会自动退回。</p><button className="primary" type="button" disabled={busy || balance < 1} onClick={onNext}>{busy ? "正在提交…" : balance < 1 ? "智慧种子不足" : "确认种下 1 颗智慧种子"} <span>●</span></button><button className="text-action" type="button" onClick={onBack}>再想一想</button></section>;
}

function DailyGenerating({ name, balance, onBack }: { name: string; balance: number; onBack: () => void }) {
  return <section className="daily-page daily-generating"><DailyHeader onBack={onBack} balance={balance} /><div className="growing-report" aria-hidden="true"><div className="report-soil" /><i className="report-stem" /><i className="report-leaf a" /><i className="report-leaf b" /><span>●</span></div><p className="eyebrow">YOUR SEED IS GROWING</p><h1>{name}，你的今日指引<br />正在生长</h1><div className="generation-list"><span className="done">✓ 感受你的今日节律</span><span className="done">✓ 连接生命智慧档案</span><span className="active">· 整理事业与个人状态</span><span>· 长成今日行动建议</span></div><p className="quiet-wait">不用着急，生成完成后会自动打开</p></section>;
}

function DailyReport({ name, insight, balance, onBack, onNext }: { name: string; insight: DailyInsight | null; balance: number; onBack: () => void; onNext: () => void }) {
  const content = insight?.content;
  return <section className="daily-page daily-report"><DailyHeader onBack={onBack} balance={balance} /><div className="report-scroll"><p className="eyebrow">TODAY · {insight?.localDate || "今日"}</p><h1>{name}的今日能量指引</h1><div className="energy-header"><div><span>中</span><small>今日能量</small></div><p><small>今日关键词</small><strong>{content?.theme || "回到自己的节奏"}</strong></p></div><article className="report-opening"><b>今日总览</b><h2>{content?.theme || "把重要的事，放在心静之后"}</h2><p>{content?.insight || insight?.fallback?.message || "今天的指引已经生成。"}</p></article><div className="report-columns"><article><small>今日行动</small><h3>从一件小事开始</h3><p>{content?.action || "为自己留出一点安静的时间。"}</p></article><article><small>今日反思</small><h3>问问自己</h3><p>{content?.reflectionQuestion || "此刻对我真正重要的是什么？"}</p></article></div>{content?.notice && <blockquote>{content.notice}</blockquote>}<button className="primary" type="button" onClick={onNext}>收下今天的行动 <span>→</span></button></div></section>;
}

function DailyAction({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [choice, setChoice] = useState("留白十分钟");
  const actions = ["留白十分钟", "推迟一次仓促回应", "写下今天最重要的一件事"];
  return <section className="daily-page daily-action"><DailyHeader onBack={onBack} balance={2} /><p className="eyebrow">ONE SMALL STEP</p><h1>让今天的智慧<br />落在一个行动里</h1><p className="daily-lead">不需要改变很多，只选择一件此刻愿意做到的小事。</p><div className="action-seed" aria-hidden="true"><i /><span>芽</span></div><div className="action-options">{actions.map((action) => <button type="button" key={action} className={choice === action ? "active" : ""} onClick={() => setChoice(action)}><i>{choice === action ? "✓" : ""}</i><span>{action}</span></button>)}</div><div className="timeline-note"><i>❧</i><p><strong>完成后会记入成长时间线</strong>它会成为你今天留下的一片新叶。</p></div><button className="primary" type="button" onClick={onNext}>选择这个行动 <span>→</span></button></section>;
}

function DailyShare({ name, onBack, onGenerate, onHome }: { name: string; onBack: () => void; onGenerate: () => void; onHome: () => void }) {
  return <section className="daily-page daily-share"><DailyHeader onBack={onBack} balance={2} /><p className="eyebrow">TODAY&apos;S FRUIT</p><h1>今天的指引<br />已经成为一份收获</h1><div className="share-card"><div className="share-brand">身心游 <small>SATORI</small></div><div className="share-energy"><span>中</span><small>今日能量</small></div><p>{name || "小满"}的今日指引</p><h2>先稳住自己<br />再回应世界</h2><blockquote>给自己十分钟留白，让清晰自然长出来。</blockquote><div className="share-growth"><i>●</i><b /><i>♧</i><b /><i>❧</i><b /><i>✦</i></div><footer>2026.08.06 · 今日能量指引</footer></div><p className="share-privacy">分享卡不包含出生资料与完整报告内容</p><button className="primary" type="button" onClick={onGenerate}>生成分享图片 <span>↗</span></button><button className="text-action" type="button" onClick={onHome}>完成，回到今日首页</button></section>;
}

function ShareOptions({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [method, setMethod] = useState("保存图片");
  const methods = [["保存图片", "存入手机相册后自由分享", "↓"], ["系统分享", "调用手机支持的分享方式", "↗"], ["复制分享文案", "复制今日关键词与短句", "文"]];
  return <section className="share-flow share-options"><DailyHeader onBack={onBack} balance={2} /><p className="eyebrow">SHARE YOUR INSIGHT</p><h1>想怎样分享<br />今天的这份收获？</h1><p className="share-lead">选择一种方式，我们会先生成不含隐私信息的分享图片。</p><div className="share-preview-mini"><div><span>中</span><small>今日能量</small></div><p>先稳住自己<br /><strong>再回应世界</strong></p><i>❧</i></div><div className="share-methods">{methods.map(([title, note, icon]) => <button type="button" key={title} className={method === title ? "active" : ""} onClick={() => setMethod(title)}><i>{icon}</i><span><strong>{title}</strong><small>{note}</small></span><b>{method === title ? "✓" : ""}</b></button>)}</div><div className="share-safe"><span className="lock" /><p><strong>默认保护你的隐私</strong>不包含出生日期、地点、卡牌干支与完整报告。</p></div><button className="primary" type="button" onClick={onNext}>继续生成分享图片 <span>→</span></button></section>;
}

function ShareGenerating({ onBack, onSuccess, onFailure }: { onBack: () => void; onSuccess: () => void; onFailure: () => void }) {
  return <section className="share-flow share-generating"><DailyHeader onBack={onBack} balance={2} /><div className="image-growing" aria-hidden="true"><div className="paper"><i>中</i><span /><b /></div><div className="image-sprout"><i /><i /></div><span className="render-ring one" /><span className="render-ring two" /></div><p className="eyebrow">GROWING AN IMAGE</p><h1>正在把今天的智慧<br />长成一张图片</h1><div className="render-progress"><i /><span>适配高清分享尺寸</span></div><p className="share-wait">正在整理文字、颜色与隐私信息，请稍候</p><button className="text-action" type="button" onClick={onSuccess}>原型中查看生成完成 →</button><button className="prototype-failure" type="button" onClick={onFailure}>原型分支 · 查看生成失败</button></section>;
}

function ShareSuccess({ onBack, onHome }: { onBack: () => void; onHome: () => void }) {
  const [saved, setSaved] = useState(false);
  return <section className="share-flow share-success"><DailyHeader onBack={onBack} balance={2} /><div className="success-bloom" aria-hidden="true"><i /><i /><i /><i /><span>✓</span></div><p className="eyebrow">READY TO SHARE</p><h1>{saved ? "图片已保存" : "分享图片已经长好"}</h1><p className="share-lead">{saved ? "可以前往微信、朋友圈或其他应用分享。" : "高清图片已生成，保存后即可分享给你在意的人。"}</p><div className="ready-image"><span>中<small>今日能量</small></span><p>先稳住自己<br /><strong>再回应世界</strong></p><footer>身心游 · SATORI</footer></div><div className="ready-actions"><button type="button" onClick={() => setSaved(true)}><i>↓</i><span><strong>保存图片</strong><small>{saved ? "已保存到相册" : "高清分享图"}</small></span></button><button type="button"><i>↗</i><span><strong>系统分享</strong><small>打开手机分享菜单</small></span></button></div><p className="share-toast" aria-live="polite">{saved ? "✓ 保存成功" : "图片将在设备支持的范围内保存或分享"}</p><button className="primary" type="button" onClick={onHome}>完成，回到今日首页 <span>→</span></button></section>;
}

function ShareFailure({ onBack, onRetry, onHome }: { onBack: () => void; onRetry: () => void; onHome: () => void }) {
  return <section className="share-flow share-failure"><DailyHeader onBack={onBack} balance={2} /><div className="resting-seed" aria-hidden="true"><i /><span>●</span></div><p className="eyebrow">NOT LOST, JUST PAUSED</p><h1>图片暂时没有生成</h1><p className="share-lead">今天的指引与行动都已保存。可能是网络波动或浏览器暂时不支持图片生成。</p><div className="failure-card"><p><strong>你可以这样继续</strong></p><span><b>01</b>重新尝试生成图片</span><span><b>02</b>复制今日分享文案</span><span><b>03</b>稍后从今日记录再次分享</span></div><button className="primary" type="button" onClick={onRetry}>重新生成图片 <span>↻</span></button><button className="secondary-action" type="button">复制分享文案</button><button className="text-action" type="button" onClick={onHome}>暂不分享，回到今日首页</button></section>;
}

function ReadingHeader({ onBack }: { onBack?: () => void }) {
  return <header className="reading-header">{onBack ? <button className="back-button" type="button" onClick={onBack}>←</button> : <Brand compact />}<span>问事</span><div className="mini-balance"><i>●</i>2</div></header>;
}

function ReadingHome({ navigate, onNext, onHistory }: { navigate: (step: number) => void; onNext: () => void; onHistory: () => void }) {
  const prompts = ["我该如何面对现在的工作变化？", "这段关系里，我真正需要看见什么？", "两个选择之间，什么更适合现在的我？"];
  return <section className="reading-page reading-home"><ReadingHeader /><div className="reading-orbit" aria-hidden="true"><div className="card-stack"><i /><i /><span>问</span></div><b /><b /></div><p className="eyebrow">ASK · DRAW · REFLECT</p><h1>带着一个问题<br />来听听牌想说什么</h1><p className="reading-lead">它不会替你决定未来，而是陪你换一个角度，看清此刻的自己与下一步。</p><button className="start-reading" type="button" onClick={onNext}><span>开始一次新的问事</span><b>→</b><small>自然写下你正在关心的事</small></button><div className="prompt-list"><header><strong>不知道怎么问？</strong><span>试试这些</span></header>{prompts.map(prompt => <button type="button" key={prompt} onClick={onNext}>{prompt}<b>›</b></button>)}</div><div className="reading-recent"><span><i>续</i><p><strong>最近一次问事</strong><small>工作方向 · 昨天</small></p></span><button type="button" onClick={onHistory}>全部记录</button></div><MainNav active="问事" navigate={navigate} /></section>;
}

function ReadingQuestion({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [question, setQuestion] = useState("我该如何面对现在的工作变化？");
  const types = ["事业", "情感", "财富", "健康", "选择", "个人状态"];
  const [type, setType] = useState("事业");
  return <section className="reading-page question-input"><ReadingHeader onBack={onBack} /><p className="eyebrow">YOUR QUESTION</p><h1>此刻，你最想问什么？</h1><p className="reading-lead">尽量问与你自己有关、当下能够行动的问题。</p><div className="question-box"><textarea value={question} maxLength={120} onChange={e => setQuestion(e.target.value)} aria-label="输入想问的问题" /><div><small>{question.length} / 120</small><button type="button">清空</button></div></div><div className="question-guide"><strong>更容易获得启发的问法</strong><p>“我可以如何……”　“我需要看见什么……”</p><small>避免只问“会不会”“是不是”，也不替第三方窥探隐私。</small></div><div className="question-types"><small>这更接近哪个方向？</small><div>{types.map(item => <button type="button" key={item} className={type === item ? "active" : ""} onClick={() => setType(item)}>{item}</button>)}</div></div><button className="primary" type="button" onClick={onNext} disabled={question.trim().length < 6}>看看我真正想问的是什么 <span>→</span></button></section>;
}

function ReadingConfirm({ onBack, onNext, onSafety }: { onBack: () => void; onNext: () => void; onSafety: () => void }) {
  const [focus, setFocus] = useState("找到适合自己的应对方式");
  return <section className="reading-page reading-confirm"><ReadingHeader onBack={onBack} /><p className="eyebrow">MAKE IT CLEAR</p><h1>让问题更靠近<br />你真正关心的事</h1><div className="original-question"><small>你刚才写下</small><p>“我该如何面对现在的工作变化？”</p></div><div className="clarified-question"><span>整理后的问题</span><h2>面对当前的工作变化，我可以如何看清自己的位置，并找到更适合的应对方式？</h2><button type="button">修改问题</button></div><div className="focus-choice"><small>这次最想获得什么？</small>{["看清变化背后的意义", "找到适合自己的应对方式", "理解内心真正的顾虑"].map(item => <button type="button" className={focus === item ? "active" : ""} key={item} onClick={() => setFocus(item)}><i>{focus === item ? "✓" : ""}</i>{item}</button>)}</div><div className="reading-boundary"><i>心</i><p><strong>牌提供理解，不替你做决定</strong>最后的选择仍然属于你。</p></div><button className="primary" type="button" onClick={onNext}>确认这个问题 <span>→</span></button><button className="prototype-failure" type="button" onClick={onSafety}>原型分支 · 查看安全替代路径</button></section>;
}

function ReadingSafety({ onBack, onContinue, onRewrite }: { onBack: () => void; onContinue: () => void; onRewrite: () => void }) {
  return <section className="reading-page reading-safety"><ReadingHeader onBack={onBack} /><div className="safety-lantern" aria-hidden="true"><i /><span>护</span></div><p className="eyebrow">A SAFER WAY TO ASK</p><h1>这个问题需要换一种<br />更安全的问法</h1><p className="reading-lead">卡牌不能代替医疗诊断、投资决策、法律意见，也不适合预测他人的隐私与意图。</p><div className="unsafe-example"><small>原来的问法</small><p>“我是不是得了严重的病？”</p></div><div className="safe-alternative"><small>可以换成</small><h2>“面对最近的身体不适，我可以怎样照顾好自己的情绪，并为就医做好准备？”</h2><span>建议：身体不适请及时咨询专业医生</span></div><button className="primary" type="button" onClick={onContinue}>使用建议问法继续 <span>→</span></button><button className="outline-button" type="button" onClick={onRewrite}>重新写一个问题</button><button className="text-action" type="button">查看紧急帮助与专业资源</button></section>;
}

function ReadingSpread({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [spread, setSpread] = useState("双卡");
  const spreads = [{ name:"单卡", count:"1", title:"此刻的一份提醒", note:"适合问题清楚，希望获得一个聚焦方向", seed:"1" }, { name:"双卡", count:"2", title:"看见两面的关系", note:"适合理解双方、两个选择或内在拉扯", seed:"2" }, { name:"多卡", count:"3—5", title:"展开一段完整脉络", note:"适合较复杂的问题与多个影响因素", seed:"按张数" }];
  return <section className="reading-page spread-select"><ReadingHeader onBack={onBack} /><p className="eyebrow">CHOOSE YOUR SPREAD</p><h1>这个问题，适合怎样展开？</h1><p className="reading-lead">我们根据问题推荐双卡，你也可以自己选择。</p><div className="spread-list">{spreads.map(item => <button type="button" key={item.name} className={spread === item.name ? "active" : ""} onClick={() => setSpread(item.name)}><div className={`spread-cards count-${item.count.charAt(0)}`}><i /><i /><i /></div><span><small>{item.name} · {item.count} 张</small><strong>{item.title}</strong><p>{item.note}</p></span><b>{spread === item.name ? "✓" : ""}</b><em>{item.seed} ●</em></button>)}</div><div className="spread-recommend"><span>荐</span><p><strong>为什么推荐双卡？</strong>你的问题同时包含外部变化与内心应对，两张牌更容易看见它们之间的关系。</p></div><button className="primary" type="button" onClick={onNext}>选择{spread}，继续 <span>→</span></button><p className="next-hint">下一步将确认两张牌各自的位置，确认前不会消耗智慧种子</p></section>;
}

function ReadingStep({ onBack, eyebrow, title, lead, children, action, onNext }: { onBack: () => void; eyebrow: string; title: React.ReactNode; lead?: string; children: React.ReactNode; action?: string; onNext?: () => void }) {
  return <section className="reading-page reading-step"><ReadingHeader onBack={onBack} /><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{lead && <p className="reading-lead">{lead}</p>}<div className="reading-step-body">{children}</div>{action && onNext && <button className="primary" type="button" onClick={onNext}>{action}<span>→</span></button>}</section>;
}

function ReadingConfig({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [mode,setMode]=useState("外部变化 / 内心应对");
  return <ReadingStep onBack={onBack} eyebrow="TWO POSITIONS" title={<>为两张牌<br />确定各自的位置</>} lead="每张牌只回答一个角色，关系才会清晰。" action="确认位置配置" onNext={onNext}><div className="position-preview"><article><b>1</b><span>外部变化</span><small>我正在面对什么</small></article><i>↔</i><article><b>2</b><span>内心应对</span><small>我可以如何回应</small></article></div><div className="config-options">{["外部变化 / 内心应对","现状 / 下一步","担心的事 / 真正的需要"].map(x=><button className={mode===x?"active":""} onClick={()=>setMode(x)} key={x}><i>{mode===x?"✓":""}</i>{x}</button>)}</div><div className="rule-note">两张牌的位置确认后，将和抽到的牌一起冻结，不会在报告生成时悄悄交换。</div></ReadingStep>;
}


function ReadingPayment({ onBack, onNext, onInsufficient }: { onBack: () => void; onNext: () => void; onInsufficient: () => void }) {
  return <ReadingStep onBack={onBack} eyebrow="CONFIRM & PLANT" title="确认这次问事" lead="种子只在报告任务成功创建后扣除。" action="确认并种下 2 颗智慧种子" onNext={onNext}><div className="reading-order"><small>本次内容</small><h2>工作变化 · 双卡问事</h2><p>外部变化 / 内心应对</p><div><span>卡牌体系</span><strong>默认关系智慧卡牌</strong></div><div><span>抽牌方式</span><strong>系统随机抽取</strong></div><div className="cost"><span>需要智慧种子</span><strong>2 ●</strong></div></div><div className="balance-change"><span>当前余额 <b>2</b></span><i>→</i><span>完成后 <b>0</b></span></div><p className="refund-note">生成失败或未形成有效报告，将自动退回智慧种子。</p><button className="prototype-failure" type="button" onClick={onInsufficient}>原型分支 · 查看智慧种子不足</button></ReadingStep>;
}

function ReadingShuffle({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return <section className="reading-page immersive-reading"><ReadingHeader onBack={onBack}/><div className="shuffle-stage"><i/><i/><i/><i/><i/><span>静</span></div><p className="eyebrow">BE WITH YOUR QUESTION</p><h1>先让心安静下来</h1><p>在心里再读一遍你的问题。<br/>准备好时，让牌慢慢展开。</p><button className="primary" onClick={onNext}>我准备好了 <span>→</span></button><small>抽牌结果一经确认将被保存</small></section>;
}

function ReadingDraw({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return <section className="reading-page draw-page"><ReadingHeader onBack={onBack}/><p className="eyebrow">TWO CARDS DRAWN</p><h1>两张牌已经为你抽出</h1><p className="reading-lead">系统完成公平随机抽取，结果已经保存。</p><div className="random-pair"><article><i/><span>1</span><small>外部变化</small></article><article><i/><span>2</span><small>内心应对</small></article></div><div className="fair-note"><span>衡</span><p><strong>本次抽取已经固定</strong>刷新或离开页面也不会改变结果。</p></div><button className="primary" onClick={onNext}>翻开这两张牌 <span>→</span></button></section>;
}

function ReadingReveal({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return <ReadingStep onBack={onBack} eyebrow="YOUR CARDS" title="牌已经回应了你的问题" lead="确认后，这两张牌与位置将冻结并用于生成报告。" action="确认卡牌，生成问事报告" onNext={onNext}><div className="revealed-pair"><article className="forest"><small>外部变化</small><i/><strong>辛巳</strong><p>在变化中辨认真正有价值的方向</p></article><article className="water"><small>内心应对</small><i/><strong>甲子</strong><p>允许自己回到起点，重新选择</p></article></div><div className="frozen-note"><span>封</span><p><strong>本次输入即将冻结</strong>问题、牌阵位置、抽牌方式与卡牌会被共同保存。</p></div></ReadingStep>;
}

function ReadingGenerate({ onBack, onSuccess, onFailure, onLeave, onNetworkError }: { onBack: () => void; onSuccess: () => void; onFailure: () => void; onLeave: () => void; onNetworkError: () => void }) {
  return <section className="reading-page reading-generating"><ReadingHeader onBack={onBack}/><div className="reading-grow"><i/><i/><span>析</span></div><p className="eyebrow">READING THE CONNECTION</p><h1>正在读懂两张牌<br/>之间的关系</h1><div className="generation-list"><span className="done">✓ 固定问题与卡牌版本</span><span className="done">✓ 读取每张牌的生命信息</span><span className="active">· 理解两张牌的关系方向</span><span>· 整理五段式问事报告</span></div><p>可以离开页面，完成后会在消息中心提醒你</p><button className="text-action" onClick={onSuccess}>原型中直接查看报告 →</button><button className="outline-button" onClick={onLeave}>先离开，查看完成提醒</button><button className="prototype-failure" onClick={onFailure}>原型分支 · 查看生成失败</button><button className="prototype-failure" onClick={onNetworkError}>原型分支 · 查看网络中断</button></section>;
}

function ReadingFailure({ onBack, onRetry }: { onBack: () => void; onRetry: () => void }) {
  return <ReadingStep onBack={onBack} eyebrow="PAUSED, NOT LOST" title={<>报告暂时没有长成</>} lead="问题、卡牌和抽取结果都已安全保存，不需要重新抽牌。"><div className="failure-seed"><span>●</span><i/></div><div className="failure-card"><p><strong>智慧种子没有损失</strong></p><span><b>01</b>本次 2 颗种子仍处于预留状态</span><span><b>02</b>重新生成不会再次扣除</span><span><b>03</b>超过处理时间会自动退回</span></div><button className="primary" onClick={onRetry}>使用原卡牌重新生成 <span>↻</span></button><button className="text-action">稍后在问事历史继续</button></ReadingStep>;
}

function ReadingReport({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return <section className="reading-page reading-report"><ReadingHeader onBack={onBack}/><div className="reading-report-scroll"><p className="eyebrow">YOUR READING</p><h1>变化不是在催你离开<br/>而是在邀请你重新选择</h1><div className="report-card-pair"><span>辛巳<small>外部变化</small></span><i>↔</i><span>甲子<small>内心应对</small></span></div>{[["01 · 先说结论","你面对的并不是一个必须立刻做出决定的时刻。真正重要的，是辨认哪些变化值得回应，哪些只是外界的噪声。"],["02 · 此刻的你","你对工作中的价值与秩序非常敏锐，所以变化越多，越容易担心自己是否失去了原来的位置。"],["03 · 牌想对你说","外部正在筛选真正重要的事；内心则需要允许一次重新开始。你不必守住过去的答案。"],["04 · 可以试试","今天先写下：我想保留什么、愿意放下什么、下一步只验证什么。不要一次解决所有问题。"],["05 · 写给你的话","方向不是在焦虑中想出来的，而是在一次次诚实选择里逐渐清晰。"]].map(([h,p])=><article key={h}><h2>{h}</h2><p>{p}</p></article>)}<button className="primary" onClick={onNext}>完成阅读 <span>→</span></button></div></section>;
}


function ReadingFeedback({ onBack, onHome, onShare }: { onBack: () => void; onHome: () => void; onShare: () => void }) {
  const [feeling,setFeeling]=useState("更清楚了");
  return <section className="reading-page reading-feedback"><ReadingHeader onBack={onBack}/><div className="feedback-bloom"><span>✓</span><i/><i/></div><p className="eyebrow">READING COMPLETE</p><h1>这次问事已经完成</h1><p className="reading-lead">你的问题、卡牌与报告都已保存。</p><div className="feedback-question"><strong>现在的你，感觉怎么样？</strong><div>{["更清楚了","有些启发","还需要时间","没有帮助"].map(x=><button className={feeling===x?"active":""} onClick={()=>setFeeling(x)} key={x}>{x}</button>)}</div></div><div className="feedback-summary"><span>问事报告 <b>已保存</b></span><span>问事记录 <b>已归档</b></span><span>智慧种子 <b>-2</b></span></div><button className="primary" onClick={onHome}>完成，回到问事首页 <span>→</span></button><button className="text-action" onClick={onShare}>生成问事分享卡</button></section>;
}

function ReadingHistory({ onBack, onOpen, navigate }: { onBack: () => void; onOpen: () => void; navigate: (step: number) => void }) {
  const [filter,setFilter]=useState("全部");
  return <section className="reading-page reading-history"><ReadingHeader onBack={onBack}/><p className="eyebrow">MY READINGS</p><h1>我的问事记录</h1><p className="reading-lead">问题、卡牌与报告会一起保存，方便你回看当时的自己。</p><div className="history-filters">{["全部","事业","情感","个人状态"].map(x=><button className={filter===x?"active":""} onClick={()=>setFilter(x)} key={x}>{x}</button>)}</div><div className="history-list"><button onClick={onOpen}><small>昨天 · 事业 · 双卡</small><h2>我该如何面对现在的工作变化？</h2><p><span>辛巳</span><i>×</i><span>甲子</span><b>已完成</b></p></button><button onClick={onOpen}><small>08月02日 · 情感 · 单卡</small><h2>这段关系里，我真正需要看见什么？</h2><p><span>乙卯</span><b>已完成</b></p></button><button onClick={onOpen}><small>07月28日 · 个人状态 · 双卡</small><h2>最近的疲惫正在提醒我什么？</h2><p><span>戊辰</span><i>×</i><span>庚午</span><b>已完成</b></p></button></div><MainNav active="问事" navigate={navigate}/></section>;
}

function ReadingInsufficient({ onBack, onRecharge, onUseSingle }: { onBack: () => void; onRecharge: () => void; onUseSingle: () => void }) {
  return <section className="reading-page reading-empty"><ReadingHeader onBack={onBack}/><div className="empty-seed"><span>●</span><i/></div><p className="eyebrow">NEED MORE SEEDS</p><h1>还差 1 颗智慧种子</h1><p className="reading-lead">本次双卡问事需要 2 颗，你当前有 1 颗。问题与配置已经替你保存。</p><div className="seed-gap"><span>当前余额 <b>1 ●</b></span><i>→</i><span>本次需要 <b>2 ●</b></span></div><button className="primary" onClick={onRecharge}>去获得智慧种子 <span>→</span></button><button className="outline-button" onClick={onUseSingle}>改为单卡问事</button><button className="text-action" onClick={onBack}>暂时保存，稍后继续</button></section>;
}

function ReadingMessageReturn({ onBack, onOpen }: { onBack: () => void; onOpen: () => void }) {
  return <section className="reading-page reading-message"><ReadingHeader onBack={onBack}/><div className="message-bloom"><span>✓</span><i/><i/></div><p className="eyebrow">YOUR READING IS READY</p><h1>你的问事报告<br/>已经长好了</h1><p className="reading-lead">刚才离开没有影响生成。问题、两张卡牌和完整报告都已安全保存。</p><div className="message-card"><small>刚刚 · 问事报告</small><h2>面对当前的工作变化，我可以如何找到更适合的应对方式？</h2><p><span>辛巳</span><i>×</i><span>甲子</span><b>已完成</b></p></div><button className="primary" onClick={onOpen}>打开问事报告 <span>→</span></button><button className="text-action" onClick={onBack}>稍后从问事记录查看</button></section>;
}

function ReadingShareOptions({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [privacy,setPrivacy]=useState("隐藏问题");
  return <section className="reading-page reading-share"><ReadingHeader onBack={onBack}/><p className="eyebrow">SHARE THE INSIGHT</p><h1>把这一刻的看见<br/>分享出去</h1><p className="reading-lead">默认保护你的原始问题，只分享卡牌与对你有力量的一句话。</p><div className="reading-share-preview"><small>今日问事 · 双卡</small><div><span>辛巳</span><i>×</i><span>甲子</span></div><h2>变化不是在催你离开<br/>而是在邀请你重新选择</h2><footer>身心游 · SATORI</footer></div><div className="share-privacy"><strong>分享时展示</strong>{["隐藏问题","展示问题主题","展示完整问题"].map(x=><button className={privacy===x?"active":""} onClick={()=>setPrivacy(x)} key={x}><i>{privacy===x?"✓":""}</i>{x}</button>)}</div><button className="primary" onClick={onNext}>生成分享图片 <span>→</span></button></section>;
}

function ReadingShareGenerating({ onBack, onSuccess, onFailure }: { onBack: () => void; onSuccess: () => void; onFailure: () => void }) {
  return <section className="reading-page reading-share-generating"><ReadingHeader onBack={onBack}/><div className="share-card-grow"><i/><i/><span>问</span></div><p className="eyebrow">GROWING A SHARE CARD</p><h1>正在把这次看见<br/>长成一张图片</h1><div className="render-progress"><i/><span>整理卡牌、金句与隐私信息</span></div><button className="text-action" onClick={onSuccess}>原型中查看生成完成 →</button><button className="prototype-failure" onClick={onFailure}>原型分支 · 查看生成失败</button></section>;
}

function ReadingShareSuccess({ onBack, onHome }: { onBack: () => void; onHome: () => void }) {
  const [saved,setSaved]=useState(false);
  return <section className="reading-page reading-share-success"><ReadingHeader onBack={onBack}/><div className="success-bloom"><i/><i/><i/><span>✓</span></div><p className="eyebrow">READY TO SHARE</p><h1>{saved?"分享图片已保存":"问事分享图片已经长好"}</h1><div className="reading-share-preview ready"><small>今日问事 · 双卡</small><div><span>辛巳</span><i>×</i><span>甲子</span></div><h2>变化不是在催你离开<br/>而是在邀请你重新选择</h2><footer>身心游 · SATORI</footer></div><div className="ready-actions"><button onClick={()=>setSaved(true)}><i>↓</i><span><strong>保存图片</strong><small>{saved?"已保存到相册":"高清分享图"}</small></span></button><button><i>↗</i><span><strong>系统分享</strong><small>打开手机分享菜单</small></span></button></div><button className="primary" onClick={onHome}>完成，回到问事首页 <span>→</span></button></section>;
}

function ReadingNetworkError({ onBack, onRetry }: { onBack: () => void; onRetry: () => void }) {
  return <section className="reading-page reading-network"><ReadingHeader onBack={onBack}/><div className="resting-seed"><i/><span>连</span></div><p className="eyebrow">CONNECTION PAUSED</p><h1>网络暂时走散了</h1><p className="reading-lead">你的问题、抽到的牌与种子状态都已保存，不会重复扣除，也不会重新抽牌。</p><div className="failure-card"><p><strong>恢复连接后可以继续</strong></p><span><b>01</b>保留原问题与原卡牌</span><span><b>02</b>不会再次消耗智慧种子</span><span><b>03</b>也可以稍后从问事记录继续</span></div><button className="primary" onClick={onRetry}>重新连接并继续 <span>↻</span></button><button className="text-action" onClick={onBack}>回到问事首页</button></section>;
}

function MainNav({ active, navigate }: { active: string; navigate: (step: number) => void }) {
  const tabs = [["今日", 10, "◉"], ["问事", profileSteps.indexOf("PREVIEW-READ"), "◇"], ["成长", profileSteps.indexOf("PREVIEW-GROWTH"), "❧"], ["关系", profileSteps.indexOf("PREVIEW-RELATIONSHIP"), "∞"], ["我的", 21, "○"]] as const;
  return <nav className="main-nav" aria-label="主导航">{tabs.map(([label, step, icon]) => <button type="button" key={label} className={active === label ? "active" : ""} onClick={() => navigate(step)}><i>{icon}</i><span>{label}</span></button>)}</nav>;
}

type ComingSoonKind = "问事" | "成长" | "关系";

function ComingSoonPage({ kind, navigate }: { kind: ComingSoonKind; navigate: (step: number) => void }) {
  const content = {
    问事: { eyebrow: "ASK · DRAW · REFLECT", symbol: "问", title: "带着一个问题，\n听见新的角度", lead: "未来你可以围绕此刻关心的事随机抽取卡牌，获得温柔、清晰且可行动的个人指引。", features: ["写下情感、事业或个人状态问题", "随机抽取一至多张关系卡牌", "生成问事报告并保存历史记录"] },
    成长: { eyebrow: "SEE YOUR GROWTH", symbol: "长", title: "让每一次看见，\n慢慢连成成长轨迹", lead: "未来这里会承接更长期的认识与复访，让每日感受、深度报告和阶段变化彼此连接。", features: ["生命之光与长期生命底图", "月运、年运及专项主题报告", "个人成长时间线与阶段回顾"] },
    关系: { eyebrow: "BETWEEN TWO PEOPLE", symbol: "∞", title: "看见两个人之间，\n独特的关系语言", lead: "未来你可以从情感与事业合作两个角度，理解彼此的默契、互补、差异与相处方式。", features: ["从生命智慧档案库选择两个人", "情感伴侣与事业合作伙伴匹配", "生成隐私友好的关系报告"] },
  }[kind];
  return <section className="coming-soon-page">
    <div className="coming-growth" aria-hidden="true"><i/><i/><span>{content.symbol}</span><b/><b/></div>
    <p className="eyebrow">{content.eyebrow}</p>
    <h1>{content.title.split("\n").map((line, index) => <span key={line}>{line}{index === 0 && <br/>}</span>)}</h1>
    <p className="coming-lead">{content.lead}</p>
    <div className="coming-state"><i>芽</i><span><strong>这片新的枝叶正在生长</strong><small>将在后续版本与你见面</small></span></div>
    <div className="coming-features"><small>未来将支持</small>{content.features.map((feature, index) => <p key={feature}><b>{String(index + 1).padStart(2, "0")}</b><span>{feature}</span></p>)}</div>
    <button className="primary" type="button" onClick={() => navigate(10)}>我知道了，返回今日 <span>→</span></button>
    <MainNav active={kind} navigate={navigate}/>
  </section>;
}

function MyHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return <header className="my-header"><button className="back-button" type="button" onClick={onBack}>←</button><strong>{title}</strong><button type="button" className="header-more">•••</button></header>;
}

function MyHome({ name, balance, open }: { name: string; balance: number; open: (step: number) => void }) {
  const items = [["每日指引记录", "查看已经生成的每日指引", 24, "册"], ["账号、隐私与设置", "安全、授权和数据管理", 27, "隐"], ["消息与帮助", "通知、客服和意见反馈", 28, "信"]] as const;
  return <section className="my-page my-home"><header><Brand compact /><button className="my-message" type="button" onClick={() => open(28)}>信<i /></button></header><button className="my-identity" type="button" onClick={() => open(22)} aria-label="查看我的生命智慧档案"><div className="avatar-seed"><i /><span>{(name || "我").slice(0,1)}</span></div><div><p>你好</p><h1>{name || "我"}</h1><small>生命智慧档案已建立</small></div><b>›</b></button><button className="profile-banner" type="button" onClick={() => open(111)}><div><small>MY LIFE WISDOM ARCHIVE</small><h2>生命智慧档案库</h2><p>管理我的主档案与重要的人</p></div><div className="four-dots"><i /><i /><i /><i /></div><b>→</b></button><div className="my-assets"><button type="button" onClick={() => open(23)}><span>●</span><div><small>智慧种子</small><strong>{balance}</strong></div><b>›</b></button></div><div className="my-menu">{items.map(([title,note,step,icon]) => <button type="button" key={title} onClick={() => open(step)}><i>{icon}</i><span><strong>{title}</strong><small>{note}</small></span><b>›</b></button>)}</div><MainNav active="我的" navigate={open} /></section>;
}

function MyProfile({ home, revision, onBack }: { home: HomeOverview | null; revision: ProfileRevision | null; onBack: () => void }) {
  const tones = ["sunset", "forest", "water", "earth"];
  const cards = (revision?.cards || home?.cards || []).map((card, index) => [card.title, card.cardCode, tones[index % tones.length]]);
  const birth = revision?.originalInput;
  const birthDate = birth ? `${birth.date.year}.${String(birth.date.month).padStart(2,"0")}.${String(birth.date.day).padStart(2,"0")}` : "—";
  return <section className="my-page my-detail"><MyHeader title="生命智慧档案" onBack={onBack} /><div className="profile-owner"><span>{(home?.profile.displayName || "我").slice(0,1)}</span><div><h1>{home?.profile.displayName || "我的生命智慧档案"}</h1><p>当前版本 V{revision?.revisionNumber || 1} · {home?.profile.state === "ACTIVE" ? "已确认" : "待确认"}</p></div></div><div className="my-card-grid">{cards.map(([name,mark,tone]) => <article className={tone} key={name}><small>{name}</small><strong>{mark}</strong><i /></article>)}</div><section className="detail-section"><h2>档案信息</h2><p><span>出生日期</span><strong>{birthDate}</strong></p><p><span>出生时间</span><strong>{birth?.time.localTime || "未提供"} · {birth?.timePrecision || "—"}</strong></p><p><span>出生地点 ID</span><strong>{birth?.locationId || "—"}</strong></p></section><button className="outline-button" type="button">编辑出生资料</button><button className="text-action" type="button">查看版本与历史影响</button></section>;
}

function MySeeds({ account, transactions, onBack }: { account: WisdomSeedAccount | null; transactions: WisdomSeedTransaction[]; onBack: () => void }) {
  const [tab,setTab]=useState("最近记录");
  const records=transactions.map((item) => ({ kind: item.amount >= 0 ? "获得" : "使用", icon: item.businessType === "REGISTRATION_REWARD" ? "礼" : "芽", title: item.title || (item.businessType === "REGISTRATION_REWARD" ? "新用户启程礼" : "今日能量指引"), time: new Date(item.createdAt).toLocaleString("zh-CN"), value: `${item.amount > 0 ? "+" : ""}${item.amount}` }));
  const shown=tab==="最近记录"?records:records.filter(x=>x.kind===tab);
  return <section className="my-page my-detail"><MyHeader title="我的智慧种子" onBack={onBack} /><div className="seed-wallet"><small>可用智慧种子</small><strong>{account?.available ?? "—"}</strong><span>●</span><p>每一颗种子，都可以开启一次新的看见</p></div><div className="asset-tabs">{["最近记录","获得","使用"].map(x=><button key={x} className={tab===x?"active":""} onClick={()=>setTab(x)}>{x}</button>)}</div><div className="asset-list">{shown.map(x=><article key={`${x.title}-${x.time}`}><i>{x.icon}</i><span><strong>{x.title}</strong><small>{x.time}</small></span><b className={x.value.startsWith("+")?"plus":""}>{x.value}</b></article>)}</div>{shown.length===0&&<div className="prototype-empty">这一分类暂时没有记录</div>}<p className="asset-rule">余额与流水来自当前后端账户。</p></section>;
}

function MyReports({ home, insight, onBack,onDaily }: { home: HomeOverview | null; insight: DailyInsight | null; onBack: () => void;onDaily:()=>void }) {
  const ready = home?.dailyInsight.state === "READY";
  const title = insight?.content?.theme || (ready ? "今日指引已生成" : "今天还没有生成指引");
  return <section className="my-page my-detail"><MyHeader title="每日指引记录" onBack={onBack} /><div className="report-summary"><div><small>已生成内容</small><strong>{ready ? 1 : 0}</strong><span>份</span></div><p>回看每一天<br />属于你的能量指引</p></div><div className="report-filter"><button className="active">每日指引</button></div><div className="my-report-list">{ready && <button onClick={onDaily}><small>每日指引 · {home?.dailyInsight.localDate}</small><h2>{title}</h2><p>后端状态：READY · 点击查看完整内容</p><b>›</b></button>}</div>{!ready && <div className="prototype-empty">今天还没有每日指引</div>}</section>;
}

function MyBenefits({ onBack, openShop, openOrders }: { onBack: () => void; openShop:()=>void; openOrders:()=>void }) {
  return <section className="my-page my-detail"><MyHeader title="订单与权益" onBack={onBack} /><div className="benefit-hero"><small>MY BENEFITS</small><h1>你的权益都在这里</h1><p>统一查看智慧种子、报告兑换、文创商品与交付记录。</p></div><div className="benefit-stats"><span><strong>12</strong><small>智慧种子</small></span><span><strong>0</strong><small>处理中</small></span><span><strong>6</strong><small>全部订单</small></span></div><div className="benefit-menu"><button onClick={openShop}><i>商</i><span><strong>进入商城</strong><small>购买智慧种子与兑换文创商品</small></span><b>›</b></button><button onClick={openOrders}><i>单</i><span><strong>我的订单</strong><small>购种、报告、商品与售后记录</small></span><b>›</b></button><button><i>种</i><span><strong>智慧种子明细</strong><small>获得、使用、退回与奖励</small></span><b>›</b></button></div></section>;
}

function MyStudyCompanion({ onBack }: { onBack: () => void }) {
  return <section className="my-page my-detail study-companion"><MyHeader title="助学童子" onBack={onBack} /><div className="companion-orbit"><span>童</span><i /><i /></div><p className="eyebrow">FOR ACADEMY STUDENTS</p><h1>把课堂里的理解<br />带回每天的生活</h1><p className="companion-lead">助学童子为身心游关系学院学员提供课程复习、练习陪伴和专属权益。</p><div className="student-state"><small>当前身份</small><strong>尚未绑定学院学员身份</strong><p>绑定后可查看你的课程、练习和智慧种子赠送记录。</p></div><button className="primary" type="button">绑定学员身份 <span>→</span></button><button className="text-action" type="button">先了解助学童子</button></section>;
}

function MySettings({ onBack, onLogout, busy }: { onBack: () => void; onLogout: () => void; busy: boolean }) {
  const groups = [["账号安全", "手机号、登录设备与异常提醒"], ["隐私中心", "数据用途、授权与分享管理"], ["数据管理", "导出、删除与账号注销"], ["通知设置", "日签提醒、消息与锁屏隐私"], ["通用设置", "语言、文字大小与动态效果"]];
  return <section className="my-page my-detail"><MyHeader title="账号、隐私与设置" onBack={onBack} /><div className="safety-score"><span>安</span><div><small>当前状态</small><strong>账号与资料保护正常</strong><p>上次安全检查：今天</p></div></div><div className="settings-list">{groups.map(([title,note]) => <button type="button" key={title}><span><strong>{title}</strong><small>{note}</small></span><b>›</b></button>)}</div><button className="danger-action" type="button" onClick={onLogout} disabled={busy}>{busy ? "正在退出…" : "退出当前账号"}</button><p className="settings-foot"><span className="lock" />退出后需要重新验证手机号才能进入档案</p></section>;
}

function MySupport({ onBack }: { onBack: () => void }) {
  return <section className="my-page my-detail"><MyHeader title="消息与帮助" onBack={onBack} /><div className="message-overview"><div><span>信</span><i>2</i></div><p><small>待你查看</small><strong>2 条新消息</strong></p><button>查看全部</button></div><div className="recent-messages"><h2>最近消息</h2><article><i>芽</i><span><strong>今日行动提醒</strong><small>别忘了为自己留白十分钟</small></span><time>刚刚</time></article><article><i>礼</i><span><strong>智慧种子已到账</strong><small>新用户启程礼已放入你的账户</small></span><time>今天</time></article></div><div className="support-grid"><button><i>?</i><span>帮助中心</span></button><button><i>话</i><span>联系客服</span></button><button><i>正</i><span>内容纠错</span></button><button><i>!</i><span>安全反馈</span></button></div></section>;
}

function WisdomArchive({profiles,self,onBack,onAdd,onSelf,onPerson}:{profiles:LifeProfile[];self:LifeProfile|null;onBack:()=>void;onAdd:()=>void;onSelf:()=>void;onPerson:(profile:LifeProfile)=>void}){
  const [group,setGroup]=useState("全部");
  const relationLabel:Record<string,string>={FAMILY:"家人",FRIEND:"朋友",COLLEAGUE:"同事",OTHER:"其他"};
  const people=profiles.filter((profile)=>profile.subjectType==="OTHER").map((profile)=>({profile,label:relationLabel[profile.relationshipType || "OTHER"] || "其他"}));
  const shown=people.filter((item)=>group==="全部"||item.label===group);
  return <section className="my-page archive-page"><MyHeader title="生命智慧档案库" onBack={onBack}/><div className="archive-owner" onClick={onSelf} role="button" tabIndex={0}><span>{(self?.displayName||"我").slice(0,1)}</span><p><small>我的主档案 · 唯一</small><strong>{self?.displayName||"我的生命智慧档案"}</strong><b>{self?.state==="ACTIVE"?"四张关系卡牌已点亮":"档案待完善"}</b></p><i>›</i></div><div className="archive-tools"><label>⌕<input aria-label="搜索档案" placeholder="搜索姓名、称呼或关系"/></label><button onClick={onAdd}>＋ 添加人物</button></div><div className="archive-groups">{["全部","家人","朋友","同事","其他"].map(x=><button key={x} className={group===x?"active":""} onClick={()=>setGroup(x)}>{x}</button>)}</div><div className="people-title"><strong>{group}档案</strong><small>共 {shown.length} 人</small></div><div className="people-list">{shown.map(({profile,label})=><button key={profile.profileId} onClick={()=>onPerson(profile)}><span>{profile.displayName.slice(0,1)}</span><p><strong>{profile.displayName}<em>{label}</em></strong><small>{profile.state==="ACTIVE"?"四张卡牌已生成":"出生资料待完善"}</small></p><i>{profile.state==="ACTIVE"?"私人记录":"待完善"}</i><b>›</b></button>)}</div>{shown.length===0&&<div className="prototype-empty">这一分组暂无人物档案</div>}</section>
}

function NewPersonArchive({data,locations,busy,onChange,onBack,onNext}:{data:ProfileData;locations:Location[];busy:boolean;onChange:(data:ProfileData)=>void;onBack:()=>void;onNext:()=>void}){const relations=[["家人","FAMILY"],["朋友","FRIEND"],["同事","COLLEAGUE"],["其他","OTHER"]] as const;return <section className="my-page archive-page"><MyHeader title="新建人物档案" onBack={onBack}/><p className="eyebrow">ONE IMPORTANT PERSON</p><h1>把一个重要的人<br/>轻轻放进你的关系地图</h1><label className="archive-field"><span>姓名或你熟悉的称呼</span><input value={data.name} onChange={e=>onChange({...data,name:e.target.value})}/></label><div className="relation-picks"><small>与我的关系</small><div>{relations.map(([label,value])=><button key={value} className={data.relationshipType===value?"active":""} onClick={()=>onChange({...data,relationshipType:value})}>{label}</button>)}</div></div><div className="birth-fields"><label><span>出生日期</span><input type="date" value={data.date} onChange={e=>onChange({...data,date:e.target.value})}/></label><label><span>出生时间</span><input type="time" value={data.time} onChange={e=>onChange({...data,time:e.target.value})}/></label></div><label className="archive-field"><span>出生地点</span><input value={data.place} onChange={e=>onChange({...data,place:e.target.value,locationId:""})}/></label>{locations.map(location=><button className="place-result" key={location.locationId} onClick={()=>onChange({...data,place:location.displayName,locationId:location.locationId})}><span className="place-pin">{location.displayName.slice(0,1)}</span><span><strong>{location.displayName}</strong><small>{location.timezone}</small></span><b>{data.locationId===location.locationId?"✓":"选择"}</b></button>)}<div className="relation-picks"><small>计算性别</small><div>{([["FEMALE","女"],["MALE","男"]] as const).map(([value,label])=><button key={value} className={data.gender===value?"active":""} onClick={()=>onChange({...data,gender:value})}>{label}</button>)}</div></div><label className="timeline-switch"><span><strong>我确认这些资料来自本人或正当知情</strong><small>档案默认仅自己可见，不代表对方已授权</small></span><input type="checkbox" defaultChecked/></label><button className="primary" disabled={busy||!data.name.trim()||!data.locationId} onClick={onNext}>{busy?"正在创建…":"继续确认出生信息"} <span>→</span></button></section>}

function ArchiveConfirm({data,revision,busy,onBack,onNext}:{data:ProfileData;revision:ProfileRevision|null;busy:boolean;onBack:()=>void;onNext:()=>void}){return <section className="my-page archive-page"><MyHeader title="确认出生信息" onBack={onBack}/><div className="confirm-person"><span>{data.name.slice(0,1)}</span><p><small>即将创建</small><strong>{data.name}的生命智慧档案</strong><b>私人记录 · 待确认</b></p></div><div className="archive-facts"><p><span>历法</span><strong>公历</strong></p><p><span>出生日期</span><strong>{data.date}</strong></p><p><span>出生时间</span><strong>{data.time} · 准确到分钟</strong></p><p><span>出生地点</span><strong>{data.place}</strong></p></div><div className="my-card-grid compact-cards">{(revision?.cards||[]).map(card=><article key={card.dimension}><small>{card.title}</small><strong>{card.cardCode}</strong><i/></article>)}</div><div className="privacy-inline"><span className="lock"/><p><strong>这是你的私人关系记录</strong><small>对方不会收到通知；共享、共同查看或互动前需另行授权。</small></p></div><button className="primary" disabled={busy} onClick={onNext}>{busy?"正在确认…":"确认并生成四张卡牌"} <span>→</span></button><button className="text-action" onClick={onBack}>返回修改</button></section>}

function ArchiveGenerating({name,onBack,onNext}:{name:string;onBack:()=>void;onNext:()=>void}){return <section className="my-page archive-page generating-archive"><MyHeader title="档案生成完成" onBack={onBack}/><div className="archive-grow"><span>{name.slice(0,1)}</span><i/><i/><b/><b/></div><p className="eyebrow">WISDOM IS READY</p><h1>四张关系卡牌<br/>已经生成</h1><p>{name}的档案已由后端确认并保存到生命智慧档案库。</p><div className="life-progress"><i><b style={{width:"100%"}}/></i><span>生成完成 · 100%</span></div><button className="primary" onClick={onNext}>查看生成后的档案 <span>→</span></button></section>}

function PersonArchive({profile,revision,onBack,onManage}:{profile:LifeProfile|null;revision:ProfileRevision|null;onBack:()=>void;onManage:()=>void}){const tones=["sunset","forest","water","earth"];return <section className="my-page archive-page"><MyHeader title="人物生命智慧档案" onBack={onBack}/><div className="person-cover"><span>{(profile?.displayName||"人").slice(0,1)}</span><small>私人关系记录</small><h1>{profile?.displayName||"人物"}的生命智慧档案</h1><p>{profile?.state==="ACTIVE"?"资料完整":"资料待完善"} · 当前为私人记录</p></div><div className="my-card-grid compact-cards">{(revision?.cards||[]).map((card,index)=><article className={tones[index%tones.length]} key={card.dimension}><small>{card.title}</small><strong>{card.cardCode}</strong><i/></article>)}</div><div className="person-feeling"><small>档案状态</small><p>该人物档案与卡牌版本均来自后端，默认仅当前账号可见。</p></div><button className="outline-button" onClick={onManage}>管理人物资料与授权</button></section>}

function PersonArchiveManage({profile,onBack,onDelete}:{profile:LifeProfile|null;onBack:()=>void;onDelete:()=>void}){return <section className="my-page archive-page"><MyHeader title="人物档案管理" onBack={onBack}/><div className="confirm-person"><span>{(profile?.displayName||"人").slice(0,1)}</span><p><small>当前档案</small><strong>{profile?.displayName||"人物档案"}</strong><b>私人记录 · {profile?.state==="ACTIVE"?"资料完整":"待完善"}</b></p></div><div className="manage-entry"><button disabled><span><strong>编辑出生信息</strong><small>后续版本开放，当前请重新创建档案</small></span><b>›</b></button><button disabled><span><strong>授权与共享状态</strong><small>当前档案默认仅自己可见</small></span><b>›</b></button></div><button className="outline-button" onClick={onBack}>返回人物档案</button><button className="danger-action" onClick={onDelete}>删除这份人物档案</button></section>}

function ArchivePicker({onBack,onAdd,onNext}:{onBack:()=>void;onAdd:()=>void;onNext:()=>void}){const [picked,setPicked]=useState(["小满"]);const people=[["小","小满","我的主档案"],["妈","妈妈","家人 · 已授权"],["言","周言","朋友 · 私人记录"],["林","林远","同事 · 待完善"]];return <section className="my-page archive-page"><MyHeader title="选择关系中的两个人" onBack={onBack}/><p className="eyebrow">TWO PEOPLE, ONE RELATIONSHIP</p><h1>从生命智慧档案库<br/>选择想理解的两个人</h1><div className="picker-slots"><span className={picked[0]?"filled":""}><i>{picked[0]?.slice(0,1)||"A"}</i><small>{picked[0]||"人物 A"}</small></span><b>∞</b><span className={picked[1]?"filled":""}><i>{picked[1]?.slice(0,1)||"B"}</i><small>{picked[1]||"人物 B"}</small></span></div><label className="picker-search">⌕<input placeholder="搜索档案"/></label><div className="picker-list">{people.map(x=><button key={x[1]} className={picked.includes(x[1])?"active":""} onClick={()=>setPicked(p=>p.includes(x[1])?p.filter(v=>v!==x[1]):p.length<2?[...p,x[1]]:[p[0],x[1]])}><span>{x[0]}</span><p><strong>{x[1]}</strong><small>{x[2]}</small></p><i>{picked.includes(x[1])?"✓":""}</i></button>)}</div><button className="archive-add-inline" onClick={onAdd}>＋ 新建一个人物档案</button><div className="task-rule">私人记录可用于你自己的关系理解；涉及对方查看、互动或共享时，会单独发起授权。</div><button className="primary" disabled={picked.length<2} onClick={onNext}>选择匹配类型 <span>→</span></button></section>}

function ArchiveDeleteImpact({name,busy,onBack,onDone}:{name:string;busy:boolean;onBack:()=>void;onDone:()=>void}){const [confirmed,setConfirmed]=useState(false);return <section className="my-page archive-page delete-impact"><MyHeader title="删除档案" onBack={onBack}/><div className="delete-symbol">删</div><p className="eyebrow">PLEASE REVIEW THE IMPACT</p><h1>删除“{name}”的档案前<br/>请确认这些影响</h1><div className="impact-list"><p><i>档</i><span><strong>四张关系卡牌将被删除</strong><small>出生资料与人物标签也会同时移除</small></span></p><p><i>∞</i><span><strong>历史报告按后端保留规则处理</strong><small>删除请求由服务端执行影响检查</small></span></p></div><label className="delete-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>我了解删除无法撤销，并确认删除这份人物档案</span></label><button className="danger-primary" disabled={!confirmed||busy} onClick={onDone}>{busy?"正在删除…":"确认永久删除"}</button><button className="outline-button" onClick={onBack}>暂不删除</button></section>}

function RelationshipHeader({title="关系",onBack}:{title?:string;onBack?:()=>void}){return <header className="relationship-header">{onBack?<button className="back-button" onClick={onBack}>←</button>:<Brand compact/>}<strong>{title}</strong><button className="relationship-more">•••</button></header>}

function RelationshipHome({navigate,onStart,onHistory}:{navigate:(step:number)=>void;onStart:(type:string)=>void;onHistory:()=>void}){return <section className="relationship-page relationship-home"><RelationshipHeader/><div className="relation-hero"><div className="relation-orbit"><span>∞</span><i/><i/></div><small>BETWEEN TWO PEOPLE</small><h1>两个人之间<br/>不只是合不合适</h1><p>看见彼此如何靠近、互补，也看见怎样相处会更舒服。</p></div><div className="relation-entry"><button onClick={()=>onStart("情感伴侣")}><i>情</i><span><small>情感伴侣</small><strong>理解吸引、默契与相处方式</strong></span><b>→</b></button><button onClick={()=>onStart("事业合作伙伴")}><i>业</i><span><small>事业合作伙伴</small><strong>理解分工、互补与合作边界</strong></span><b>→</b></button></div><button className="relation-history-link" onClick={onHistory}><span>册</span><p><strong>我的关系报告</strong><small>3 份报告 · 最近更新于昨天</small></p><b>›</b></button><div className="future-invite"><small>未来玩法</small><p>邀请更多朋友参与，寻找属于你的伴侣与事业搭子</p><span>后续开放</span></div><MainNav active="关系" navigate={navigate}/></section>}

function RelationshipDimension({initialType,onBack,onNext}:{initialType:string;onBack:()=>void;onNext:(type:string)=>void}){const [type,setType]=useState(initialType);return <section className="relationship-page"><RelationshipHeader title="选择匹配维度" onBack={onBack}/><p className="eyebrow">WHAT DO YOU WANT TO UNDERSTAND</p><h1>这一次，你想从哪个角度<br/>理解两个人的关系？</h1><div className="dimension-cards"><button className={type==="情感伴侣"?"active":""} onClick={()=>setType("情感伴侣")}><i>情</i><small>LOVE & PARTNERSHIP</small><strong>情感伴侣</strong><p>看吸引、亲密、理解方式与长期相处</p><b>{type==="情感伴侣"?"✓":""}</b></button><button className={type==="事业合作伙伴"?"active":""} onClick={()=>setType("事业合作伙伴")}><i>业</i><small>WORK & CO-CREATION</small><strong>事业合作伙伴</strong><p>看分工、决策、资源互补与合作边界</p><b>{type==="事业合作伙伴"?"✓":""}</b></button></div><div className="task-rule">同样的两个人，在不同维度会呈现不同的关系重点，可以分别生成报告。</div><button className="primary" onClick={()=>onNext(type)}>继续 · {type} <span>→</span></button></section>}

function RelationshipHistory({onBack,onOpen}:{onBack:()=>void;onOpen:(type:string)=>void}){const [tab,setTab]=useState("全部");return <section className="relationship-page"><RelationshipHeader title="我的关系报告" onBack={onBack}/><div className="relationship-stats"><span><small>全部报告</small><strong>3</strong></span><p>每一段关系<br/><b>都有自己的相处语言</b></p></div><div className="task-tabs">{["全部","情感","事业"].map(x=><button key={x} className={tab===x?"active":""} onClick={()=>setTab(x)}>{x}</button>)}</div><div className="relationship-history-list"><button onClick={()=>onOpen("情感伴侣")}><i>情</i><span><small>情感伴侣 · 昨天</small><strong>小满 × 周言</strong><p>互补成长 · 在差异里慢慢靠近</p></span><b>›</b></button><button onClick={()=>onOpen("事业合作伙伴")}><i>业</i><span><small>事业合作 · 08月02日</small><strong>小满 × 林远</strong><p>同频共创 · 一个开路，一个落地</p></span><b>›</b></button><button onClick={()=>onOpen("情感伴侣")}><i>情</i><span><small>情感伴侣 · 07月18日</small><strong>小满 × 陈舟</strong><p>温暖相依 · 日常里自然形成默契</p></span><b>›</b></button></div></section>}

function RelationshipSource({type,onBack,onDimension,onArchive,onCards}:{type:string;onBack:()=>void;onDimension:()=>void;onArchive:()=>void;onCards:()=>void}){return <section className="relationship-page"><RelationshipHeader title="选择资料方式" onBack={onBack}/><button className="outline-button relation-dimension-current" onClick={onDimension}>当前维度 · {type}<span>更换 ›</span></button><p className="eyebrow">HOW TO ADD TWO PEOPLE</p><h1>选择最方便的方式<br/>添加关系中的两个人</h1><div className="source-options"><button onClick={onArchive}><i>档</i><small>推荐普通用户</small><strong>从生命智慧档案库选择</strong><p>选择已有档案，也可以现场新建人物</p><b>→</b></button><button onClick={onCards}><i>牌</i><small>适合已知道卡牌的人</small><strong>直接输入双方四张卡牌</strong><p>无需填写出生信息，可选择保存到档案库</p><b>→</b></button></div><div className="privacy-inline"><span className="lock"/><p>报告不会展示双方出生信息；分享时也默认隐藏四张卡牌。</p></div></section>}

function RelationshipArchivePick({onBack,onAdd,onNext}:{onBack:()=>void;onAdd:()=>void;onNext:()=>void}){const [picked,setPicked]=useState(["小满"]);const people=[["小","小满","我的主档案"],["妈","妈妈","家人 · 资料完整"],["言","周言","朋友 · 资料完整"],["林","林远","同事 · 待完善"]];return <section className="relationship-page"><RelationshipHeader title="从档案库选择" onBack={onBack}/><p className="eyebrow">CHOOSE TWO PEOPLE</p><h1>选择关系中的两个人</h1><div className="picker-slots"><span className={picked[0]?"filled":""}><i>{picked[0]?.slice(0,1)||"A"}</i><small>{picked[0]||"人物 A"}</small></span><b>∞</b><span className={picked[1]?"filled":""}><i>{picked[1]?.slice(0,1)||"B"}</i><small>{picked[1]||"人物 B"}</small></span></div><label className="picker-search">⌕<input placeholder="搜索姓名、称呼或关系"/></label><div className="picker-list">{people.map(x=><button key={x[1]} className={picked.includes(x[1])?"active":""} onClick={()=>setPicked(p=>p.includes(x[1])?p.filter(v=>v!==x[1]):p.length<2?[...p,x[1]]:[p[0],x[1]])}><span>{x[0]}</span><p><strong>{x[1]}</strong><small>{x[2]}</small></p><i>{picked.includes(x[1])?"✓":""}</i></button>)}</div><button className="archive-add-inline" onClick={onAdd}>＋ 新建一个人物档案</button><button className="primary" disabled={picked.length<2} onClick={onNext}>确认这两个人 <span>→</span></button></section>}

function RelationshipCardInput({who,name,onBack,onNext}:{who:string;name:string;onBack:()=>void;onNext:()=>void}){const labels=["时空关系卡牌","事业关系卡牌","家庭关系卡牌","自我关系卡牌"];const choices=["甲子","乙丑","丙寅","丁卯","戊辰","己巳","庚午","辛未","壬申","癸酉","甲戌","乙亥"];const defaults=who==="人物 A"?["庚午","辛未","甲子","戊辰"]:["甲子","丁卯","辛未","乙亥"];const [cards,setCards]=useState(defaults);const [saved,setSaved]=useState(false);return <section className="relationship-page"><RelationshipHeader title={`输入${who}卡牌`} onBack={onBack}/><p className="eyebrow">FOUR RELATIONSHIP CARDS</p><h1>输入{who}的<br/>四张关系卡牌</h1><label className="archive-field"><span>称呼</span><input defaultValue={name}/></label><div className="relation-card-inputs">{labels.map((label,i)=><label key={label}><span><b>{String(i+1).padStart(2,"0")}</b>{label}</span><select aria-label={label} value={cards[i]} onChange={e=>setCards(v=>v.map((x,n)=>n===i?e.target.value:x))}>{choices.map(x=><option value={x} key={x}>{x}</option>)}</select></label>)}</div><div className="card-input-preview">{cards.map((x,i)=><span key={labels[i]}><small>{labels[i].replace("卡牌","")}</small><strong>{x}</strong></span>)}</div><label className="timeline-switch"><span><strong>保存到生命智慧档案库</strong><small>{saved?"完成匹配后会保存为人物档案":"默认关闭，保存后可用于下次匹配"}</small></span><input type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)}/></label><div className="task-rule">这里只输入四张卡牌，不需要填写或展示出生年月日时。</div><button className="primary" onClick={onNext}>{who==="人物 A"?"继续输入人物 B":"确认双方卡牌"} <span>→</span></button></section>}

function RelationshipConfirm({type,onBack,onNext}:{type:string;onBack:()=>void;onNext:()=>void}){return <section className="relationship-page"><RelationshipHeader title="确认匹配资料" onBack={onBack}/><p className="eyebrow">TWO PEOPLE, ONE VIEW</p><h1>确认这次要理解的关系</h1><div className="match-pair"><article><span>小</span><small>人物 A</small><strong>小满</strong><p>我的主档案 · 完整</p></article><b>∞<small>{type}</small></b><article><span>言</span><small>人物 B</small><strong>周言</strong><p>朋友档案 · 完整</p></article></div><div className="match-delivery"><strong>这份报告会包含</strong>{["关系整体感觉与标签","自然吸引与默契","差异、互补与摩擦","更舒服的相处方式","值得尝试的下一步"].map((x,i)=><p key={x}><i>{String(i+1).padStart(2,"0")}</i>{x}</p>)}</div><button className="outline-button" onClick={onBack}>查看或修改双方资料</button><button className="primary" onClick={onNext}>继续了解隐私规则 <span>→</span></button></section>}

function RelationshipPrivacy({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){return <section className="relationship-page privacy-relation"><RelationshipHeader title="隐私与使用说明" onBack={onBack}/><div className="privacy-orbit"><span>隐</span><i/><i/></div><p className="eyebrow">PRIVATE BY DEFAULT</p><h1>理解一段关系<br/>也要保护两个人</h1><div className="privacy-rules">{[["私","报告默认仅创建者可见","不会自动通知或发送给另一方"],["牌","不公开双方四张卡牌","报告和分享页都默认隐藏卡牌与出生信息"],["享","分享前再次确认","可修改称呼，并选择只分享标签与摘要"],["权","私人分析不等于对方授权","双方共同查看或互动时，需要另行获得确认"]].map(x=><article key={x[1]}><i>{x[0]}</i><span><strong>{x[1]}</strong><small>{x[2]}</small></span></article>)}</div><label className="delete-confirm"><input type="checkbox" defaultChecked/><span>我确认对这些资料具有正当知情来源，并理解本报告仅作为关系理解参考</span></label><button className="primary" onClick={onNext}>同意并继续 <span>→</span></button></section>}

function RelationshipPayment({type,onBack,onNext}:{type:string;onBack:()=>void;onNext:()=>void}){return <section className="relationship-page relation-payment"><RelationshipHeader title="确认生成" onBack={onBack}/><div className="pay-relation"><span>∞</span><i/><i/></div><p className="eyebrow">READY TO UNDERSTAND</p><h1>生成小满与周言的<br/>{type}匹配报告</h1><div className="life-order"><small>本次交付</small><h2>{type} · 完整匹配报告</h2><p>关系标签、五个核心章节与行动建议</p><div><span>消耗智慧种子</span><strong className="seed-cost">6 ●</strong></div><div><span>当前余额</span><strong>12 ●</strong></div><div><span>生成后余额</span><strong>6 ●</strong></div></div><div className="seed-protection"><span>保</span><p><strong>生成保障</strong>失败不会重复扣除，长时间未完成会按规则自动退回。</p></div><button className="primary" onClick={onNext}>确认使用 6 颗智慧种子 <span>→</span></button></section>}

function RelationshipGenerating({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){return <section className="relationship-page relation-generating"><RelationshipHeader title="正在生成关系报告" onBack={onBack}/><div className="pair-growing"><span>小</span><b>∞</b><span>言</span><i/><i/></div><p className="eyebrow">UNDERSTANDING THE CONNECTION</p><h1>正在整理两个人之间<br/>独特的关系语言</h1><div className="generation-list"><span className="done">✓　确认双方关系资料</span><span className="done">✓　整理吸引与互补线索</span><span className="active">●　生成相处与磨合建议</span><span>○　完成报告与隐私检查</span></div><div className="life-progress"><i><b style={{width:"72%"}}/></i><span>正在生成 · 72%</span></div><button className="outline-button" onClick={onNext}>预览完成后的结果</button><button className="text-action" onClick={onBack}>先离开，完成后通知我</button></section>}

function RelationshipSummary({type,onBack,onFull,onShare}:{type:string;onBack:()=>void;onFull:()=>void;onShare:()=>void}){return <section className="relationship-page relation-summary"><RelationshipHeader title="匹配结果" onBack={onBack}/><div className="relation-result-cover"><small>{type === "事业合作伙伴" ? "WORK PARTNERSHIP" : "LOVE RELATIONSHIP"}</small><div><span>小</span><b>∞</b><span>言</span></div><p>小满 × 周言 · {type}</p><h1>互补成长</h1><em>在差异里慢慢靠近，也在理解中成为更完整的自己</em></div><div className="relation-keywords"><span><small>自然吸引</small><strong>真诚直接</strong></span><span><small>关系优势</small><strong>彼此补位</strong></span><span><small>重要功课</small><strong>表达节奏</strong></span></div><div className="relation-glimpse"><small>这段关系的感觉</small><p>一个更愿意向前打开可能，一个更擅长辨认真正重要的东西。靠近时很容易被彼此不同的力量吸引，也需要给对方不同的表达速度。</p></div><button className="primary" onClick={onFull}>阅读完整匹配报告 <span>→</span></button><button className="outline-button" onClick={onShare}>分享关系标签与摘要</button></section>}

function RelationshipFullReport({type,onBack,onShare,onDone}:{type:string;onBack:()=>void;onShare:()=>void;onDone:()=>void}){const sections=[["01","关系整体感觉","你们不是完全相同的人，却容易在彼此身上看见自己缺少的那一部分。"],["02","为什么会彼此吸引","小满的行动感会带来方向，周言的细腻会让关系不只是向前，也能被认真感受。"],["03","天然默契与互补","当一方负责打开可能，另一方负责辨认价值，你们很容易形成相互补位。"],["04","容易摩擦的地方","一个倾向于尽快回应，一个需要更多时间确认感受。催促与沉默都可能被误解。"],["05","更舒服的相处方式","重要沟通前先说明自己需要的是倾听、建议还是决定，给彼此清楚而温柔的边界。"],["06","给这段关系的下一步","选择一件双方都在意的小事，一起完成，并观察真实合作时的感受。"]];return <section className="relationship-page relation-full"><RelationshipHeader title="完整匹配报告" onBack={onBack}/><div className="full-relation-intro"><span>互</span><small>小满 × 周言 · {type}</small><h1>互补成长</h1><p>一段关系的价值，不在于完全相同，而在于能否理解差异背后的需要。</p></div><div className="relation-report-sections">{sections.map(x=><article key={x[0]}><b>{x[0]}</b><span><strong>{x[1]}</strong><p>{x[2]}</p></span></article>)}</div><div className="annual-boundary"><span>参</span><p><strong>这是关系理解，不是关系判决</strong>报告不替你决定是否开始、继续或结束一段关系。</p></div><button className="primary" onClick={onDone}>保存到我的关系报告 <span>→</span></button><button className="outline-button" onClick={onShare}>生成隐私友好的分享卡片</button></section>}

function RelationshipShare({onBack,onDone}:{onBack:()=>void;onDone:()=>void}){const [names,setNames]=useState(false);return <section className="relationship-page"><RelationshipHeader title="分享关系结果" onBack={onBack}/><p className="eyebrow">SHARE THE FEELING, KEEP THE PRIVACY</p><h1>分享这段关系的感觉<br/>不分享两个人的隐私</h1><div className="relation-share-card"><small>身心游 · RELATIONSHIP</small><span>∞</span><p>{names?"小满 × 周言":"小满 × 一位朋友"}</p><h2>互补成长</h2><blockquote>在差异里慢慢靠近，也在理解中成为更完整的自己</blockquote><b>扫码看看你们的关系语言</b></div><label className="timeline-switch"><span><strong>在分享卡片显示双方称呼</strong><small>关闭时只显示“我与一位朋友”</small></span><input type="checkbox" checked={names} onChange={e=>setNames(e.target.checked)}/></label><div className="share-privacy"><span className="lock"/>不会展示四张卡牌、出生信息与完整报告</div><button className="primary" onClick={onDone}>生成并分享 <span>→</span></button></section>}

function RelationshipComplete({onHome,onHistory}:{onHome:()=>void;onHistory:()=>void}){return <section className="relationship-page relation-complete"><RelationshipHeader title="报告已保存"/><div className="complete-orbit"><span>∞</span><i/><i/></div><p className="eyebrow">A RELATIONSHIP UNDERSTOOD</p><h1>这段关系的理解<br/>已经被好好保存</h1><p>你可以随时回来看，也可以用另一个维度重新理解同样的两个人。</p><div className="feedback-summary"><span>关系报告 <b>已保存</b></span><span>报告历史 <b>已更新</b></span><span>隐私状态 <b>仅自己</b></span></div><button className="primary" onClick={onHome}>完成，回到关系首页 <span>→</span></button><button className="outline-button" onClick={onHistory}>查看我的关系报告</button></section>}

function CommerceHeader({title,onBack}:{title:string;onBack:()=>void}){return <header className="commerce-header"><button className="back-button" onClick={onBack}>←</button><strong>{title}</strong><button className="commerce-cart">袋</button></header>}

function ThirdPartyPurchase({onBack,onPoster,onSupport,onExternal}:{onBack:()=>void;onPoster:()=>void;onSupport:()=>void;onExternal:()=>void}){const [notice,setNotice]=useState("");return <section className="commerce-page"><CommerceHeader title="第三方购买" onBack={onBack}/><p className="eyebrow">CHOOSE AN AVAILABLE CHANNEL</p><h1>选择方便的购买方式</h1><div className="external-methods"><button onClick={onPoster}><i>码</i><span><strong>查看支付二维码海报</strong><small>适合微信内长按识别或另一台设备扫码</small></span><b>›</b></button><button onClick={onSupport}><i>客</i><span><strong>联系客服购买</strong><small>获取当前可用的第三方支付入口</small></span><b>›</b></button><button onClick={()=>{setNotice("正在打开经过安全校验的第三方购买页面");onExternal();}}><i>外</i><span><strong>前往外部购买页面</strong><small>将在浏览器中打开安全链接</small></span><b>↗</b></button></div>{notice&&<div className="prototype-toast">✓ {notice}</div>}<div className="task-rule">第三方支付完成后请保留订单信息；到账状态可在“我的订单”查看。</div></section>}

function SeedPoster({onBack,onPaid}:{onBack:()=>void;onPaid:()=>void}){const [saved,setSaved]=useState(false);return <section className="commerce-page commerce-center"><CommerceHeader title="扫码购买" onBack={onBack}/><p className="eyebrow">SCAN TO PURCHASE</p><h1>扫码购买600颗<br/>智慧种子</h1><div className="qr-poster"><span>身心游</span><i>▦</i><strong>¥49.9 · 600颗</strong><small>请使用微信扫码或长按识别</small></div><button className="primary" onClick={onPaid}>我已完成支付 <span>→</span></button><button className="text-action" onClick={()=>setSaved(true)}>{saved?"✓ 海报已保存到相册":"保存海报到相册"}</button></section>}

function SeedSupport({onBack,onContinue}:{onBack:()=>void;onContinue:()=>void}){const [opened,setOpened]=useState(false);return <section className="commerce-page commerce-center"><CommerceHeader title="联系客服购买" onBack={onBack}/><div className="service-orbit"><span>客</span><i/><i/></div><p className="eyebrow">PURCHASE WITH SUPPORT</p><h1>联系客服获取<br/>当前购买入口</h1><p className="commerce-lead">客服会向你发送第三方购买网站、支付二维码或外部链接，并协助确认到账。</p><div className="service-hours"><small>服务时间</small><strong>每日 09:00—21:00</strong><p>咨询时请说明：600颗智慧种子套餐</p></div>{opened&&<div className="support-opened"><strong>微信客服入口已准备</strong><p>完成支付后返回此页，系统会继续确认到账。</p></div>}<button className="primary" onClick={()=>setOpened(true)}>{opened?"已打开微信客服":"打开微信客服"} <span>→</span></button>{opened&&<button className="outline-button" onClick={onContinue}>我已完成支付，查询到账</button>}</section>}

function CommercePage({id,navigate,returnAfterSeed,onReturnAfterSeed,onSeedRecharge}:{id:string;navigate:(step:number)=>void;returnAfterSeed:number|null;onReturnAfterSeed:()=>void;onSeedRecharge:(target:number)=>void}){
  const backTargets:Record<string,number>={"SHOP-01":25,"SHOP-02":133,"SHOP-03":133,"SHOP-04":133,"SEED-01":133,"SEED-02":137,"SEED-03":138,"SEED-04":138,"SEED-05":140,"SEED-06":140,"SEED-07":138,"SEED-08":133,"SEED-09":143,"GOODS-01":133,"GOODS-02":146,"GOODS-03":147,"GOODS-04":148,"GOODS-05":149,"GOODS-06":150,"GOODS-07":150,"GOODS-08":152,"GOODS-09":153,"GOODS-10":153,"ORDER-01":133,"ORDER-02":156,"ORDER-03":156,"ORDER-04":156,"ORDER-05":156};
  const back=()=>navigate(backTargets[id]??133);
  const seedPacks=[["200","19.9","轻轻种下"],["600","49.9","持续生长"],["1200","99.9","丰盛一程"]];
  const goods=[["串","四季能量手串","380","陪伴日常的温柔提醒"],["晶","自然水晶石","260","为生活留下一处安定"],["香","草木清心香","180","让空间慢下来"],["茶","四时调和茶","220","在一杯茶里回到自己"]];
  if(id==="SHOP-01")return <section className="commerce-page"><CommerceHeader title="身心游商城" onBack={back}/><div className="shop-hero"><small>SATORI MARKET</small><h1>让每一颗智慧种子<br/>都有生长的去处</h1><p>现金只用于购买智慧种子；报告、服务与R1文创商品统一使用智慧种子兑换。</p><div><span>我的智慧种子</span><strong>12 ●</strong></div></div><div className="shop-portals"><button onClick={()=>navigate(134)}><i>种</i><span><small>智慧种子专区</small><strong>购买智慧种子</strong><p>三种固定套餐 · 多种购买方式</p></span><b>→</b></button><button onClick={()=>navigate(135)}><i>物</i><span><small>身心游文创</small><strong>用种子兑换好物</strong><p>手串、水晶、香与茶</p></span><b>→</b></button></div><button className="commerce-order-link" onClick={()=>navigate(136)}><span>单</span><p><strong>订单与消费记录</strong><small>产品、服务与智慧种子去向</small></p><b>›</b></button></section>;
  if(id==="SHOP-02"||id==="SEED-01")return <section className="commerce-page"><CommerceHeader title="智慧种子专区" onBack={back}/><p className="eyebrow">CHOOSE YOUR SEEDS</p><h1>选择适合此刻的<br/>智慧种子数量</h1><div className="seed-packages">{seedPacks.map((x,i)=><button className={i===1?"popular":""} key={x[0]} onClick={()=>navigate(138)}><small>{x[2]}{i===1&&<b>推荐</b>}</small><strong>{x[0]}<em>颗</em></strong><p>¥ {x[1]}</p><span>约 ¥ {(Number(x[1])/Number(x[0])).toFixed(3)} / 颗</span></button>)}</div><div className="commerce-rule"><strong>智慧种子可以做什么？</strong><p>兑换日签、生命之光、抽卡问事、月运、年运、关系匹配、助学童子报告及R1文创商品。</p></div><button className="outline-button" onClick={()=>navigate(136)}>查看购种记录</button></section>;
  if(id==="SHOP-03"||id==="GOODS-01")return <section className="commerce-page"><CommerceHeader title="文创商品" onBack={back}/><div className="goods-hero"><small>OBJECTS WITH MEANING</small><h1>把看见带回生活</h1><p>R1文创商品只使用智慧种子兑换</p></div><div className="goods-tabs"><button className="active">全部</button><button>手串</button><button>水晶</button><button>香</button><button>茶</button></div><div className="goods-grid">{goods.map(x=><button key={x[1]} onClick={()=>navigate(147)}><i>{x[0]}</i><small>{x[3]}</small><strong>{x[1]}</strong><p>{x[2]} ●</p></button>)}</div></section>;
  if(id==="SHOP-04"||id==="ORDER-01")return <section className="commerce-page"><CommerceHeader title="全部订单" onBack={back}/><div className="order-summary"><span><small>全部</small><strong>6</strong></span><span><small>处理中</small><strong>1</strong></span><span><small>已完成</small><strong>5</strong></span></div><div className="order-tabs"><button className="active">全部</button><button>购种</button><button>报告</button><button>文创</button></div><div className="unified-orders"><button onClick={()=>navigate(157)}><i>种</i><span><small>现金购种 · 今天</small><strong>600颗智慧种子</strong><p>¥49.9 · 已到账</p></span><b>›</b></button><button onClick={()=>navigate(158)}><i>情</i><span><small>报告兑换 · 昨天</small><strong>情感关系匹配报告</strong><p>-6 ● · 已生成</p></span><b>›</b></button><button onClick={()=>navigate(159)}><i>串</i><span><small>文创兑换 · 08月05日</small><strong>四季能量手串</strong><p>-380 ● · 已发货</p></span><b>›</b></button></div><button className="order-help" onClick={()=>navigate(160)}>退款、退种与异常处理</button></section>;
  if(id==="SEED-02")return <section className="commerce-page"><CommerceHeader title="选择购买方式" onBack={back}/><div className="selected-pack"><span>种</span><p><small>已选择</small><strong>600颗智慧种子</strong><b>¥49.9</b></p></div><div className="purchase-methods"><button onClick={()=>navigate(139)}><i>内</i><span><strong>站内支付</strong><small>在当前页面调起微信支付</small></span><b>推荐 ›</b></button><button onClick={()=>navigate(140)}><i>链</i><span><strong>第三方购买</strong><small>外部网站、二维码或联系客服</small></span><b>›</b></button></div><div className="task-rule">无论通过哪种方式购买，到账后都会进入同一个智慧种子账户。</div></section>;
  if(id==="SEED-03")return <section className="commerce-page commerce-center"><CommerceHeader title="确认站内支付" onBack={back}/><div className="pay-seed-commerce">600<small>智慧种子</small></div><h1>确认购买智慧种子</h1><div className="checkout-lines"><p><span>商品</span><strong>600颗智慧种子</strong></p><p><span>支付方式</span><strong>微信支付</strong></p><p><span>实付金额</span><strong>¥49.9</strong></p></div><button className="primary" onClick={()=>navigate(143)}>确认支付 ¥49.9 <span>→</span></button></section>;
  if(id==="SEED-04")return <ThirdPartyPurchase onBack={back} onPoster={()=>navigate(141)} onSupport={()=>navigate(142)} onExternal={()=>navigate(143)}/>;
  if(id==="SEED-05")return <SeedPoster onBack={back} onPaid={()=>navigate(143)}/>;
  if(id==="SEED-06")return <SeedSupport onBack={back} onContinue={()=>navigate(143)}/>;
  if(id==="SEED-07")return <section className="commerce-page commerce-center"><CommerceHeader title="支付处理中" onBack={back}/><div className="commerce-loading"><span>种</span><i/><i/></div><p className="eyebrow">PAYMENT IN PROGRESS</p><h1>正在确认支付结果</h1><p className="commerce-lead">请不要重复支付，确认完成后智慧种子会自动进入账户。</p><div className="life-progress"><i><b style={{width:"72%"}}/></i><span>正在向支付渠道确认</span></div><button className="outline-button" onClick={()=>navigate(144)}>预览支付成功</button><button className="prototype-failure" onClick={()=>navigate(145)}>原型分支 · 查看支付未完成</button></section>;
  if(id==="SEED-08")return <section className="commerce-page commerce-center"><CommerceHeader title="购买成功" onBack={back}/><div className="commerce-success">＋600</div><p className="eyebrow">SEEDS HAVE ARRIVED</p><h1>600颗智慧种子<br/>已经到账</h1><div className="balance-change"><p><span>到账前</span><strong>12 ●</strong></p><p><span>本次获得</span><strong>+600 ●</strong></p><p><span>当前余额</span><strong>612 ●</strong></p></div>{returnAfterSeed!==null&&<button className="primary" onClick={onReturnAfterSeed}>返回刚才的任务 <span>→</span></button>}<button className={returnAfterSeed!==null?"outline-button":"primary"} onClick={()=>navigate(133)}>回到商城 <span>→</span></button><button className="outline-button" onClick={()=>navigate(157)}>查看购种订单</button></section>;
  if(id==="SEED-09")return <section className="commerce-page commerce-center"><CommerceHeader title="支付未完成" onBack={back}/><div className="commerce-failure">!</div><p className="eyebrow">PAYMENT NEEDS ATTENTION</p><h1>暂未确认到支付结果</h1><p className="commerce-lead">如果已经付款，请不要重复支付。可以刷新到账状态或提交订单信息。</p><button className="primary" onClick={()=>navigate(143)}>重新查询支付结果 <span>→</span></button><button className="outline-button" onClick={()=>navigate(160)}>联系支持</button></section>;
  if(id==="GOODS-02")return <section className="commerce-page"><CommerceHeader title="商品详情" onBack={back}/><div className="goods-detail-visual"><span>串</span><small>HANDMADE WITH MEANING</small></div><small className="goods-category">四季能量系列</small><h1>四季能量手串</h1><p className="goods-copy">以自然材质与四季色彩，提醒你在每天的生活里回到自己的节奏。</p><div className="goods-price"><strong>380 ●</strong><span>仅支持智慧种子兑换</span></div><div className="goods-info"><p><span>材质</span><strong>天然石 · 原木配珠</strong></p><p><span>发货</span><strong>兑换后3—5个工作日</strong></p><p><span>售后</span><strong>签收后7日内申请</strong></p></div><button className="primary" onClick={()=>navigate(148)}>选择规格 <span>→</span></button></section>;
  if(id==="GOODS-03")return <section className="commerce-page"><CommerceHeader title="选择规格" onBack={back}/><div className="selected-goods"><span>串</span><p><small>四季能量手串</small><strong>380 ●</strong></p></div><div className="spec-group"><strong>手围尺寸</strong><div><button>14cm</button><button className="active">16cm</button><button>18cm</button></div></div><div className="spec-group"><strong>主题配色</strong><div><button className="active">春生</button><button>夏长</button><button>秋收</button><button>冬藏</button></div></div><div className="quantity-row"><span>数量</span><div><button>−</button><strong>1</strong><button>＋</button></div></div><button className="primary" onClick={()=>navigate(149)}>确认规格并填写地址 <span>→</span></button></section>;
  if(id==="GOODS-04")return <section className="commerce-page"><CommerceHeader title="收货地址" onBack={back}/><p className="eyebrow">WHERE SHOULD IT ARRIVE</p><h1>确认商品送达的位置</h1><div className="address-card"><span>默</span><p><strong>小满　138****6618</strong><small>浙江省杭州市西湖区文三路88号 5幢201室</small></p><b>›</b></div><button className="archive-add-inline">＋ 新增收货地址</button><div className="delivery-note-card"><strong>配送说明</strong><p>预计兑换后3—5个工作日发货，物流信息会同步到订单详情。</p></div><button className="primary" onClick={()=>navigate(150)}>使用这个地址 <span>→</span></button></section>;
  if(id==="GOODS-05")return <section className="commerce-page"><CommerceHeader title="确认种子兑换" onBack={back}/><div className="checkout-goods"><span>串</span><p><small>四季能量手串</small><strong>夏长 · 16cm × 1</strong><b>380 ●</b></p></div><div className="checkout-lines"><p><span>收货人</span><strong>小满 · 杭州市</strong></p><p><span>当前余额</span><strong>612 ●</strong></p><p><span>本次消耗</span><strong>-380 ●</strong></p><p><span>兑换后余额</span><strong>232 ●</strong></p></div><div className="task-rule">R1文创商品只使用智慧种子兑换，不支持现金或混合支付。</div><button className="primary" onClick={()=>navigate(152)}>确认使用380颗智慧种子 <span>→</span></button><button className="prototype-failure" onClick={()=>navigate(151)}>原型分支 · 查看种子不足</button></section>;
  if(id==="GOODS-06")return <section className="commerce-page commerce-center"><CommerceHeader title="智慧种子不足" onBack={back}/><div className="commerce-failure">种</div><p className="eyebrow">MORE SEEDS ARE NEEDED</p><h1>还差168颗智慧种子</h1><div className="balance-change"><p><span>商品需要</span><strong>380 ●</strong></p><p><span>当前余额</span><strong>212 ●</strong></p><p><span>还差</span><strong>168 ●</strong></p></div><button className="primary" onClick={()=>onSeedRecharge(150)}>购买智慧种子 <span>→</span></button><button className="outline-button" onClick={()=>navigate(133)}>查看其他获得方式</button><p className="return-note">购买成功后会自动返回当前商品，规格和地址都会保留。</p></section>;
  if(id==="GOODS-07")return <section className="commerce-page commerce-center"><CommerceHeader title="兑换成功" onBack={back}/><div className="commerce-success">✓</div><p className="eyebrow">YOUR ORDER IS GROWING</p><h1>四季能量手串<br/>兑换成功</h1><div className="feedback-summary"><span>消耗种子 <b>380 ●</b></span><span>订单状态 <b>等待发货</b></span><span>预计发货 <b>3—5日</b></span></div><button className="primary" onClick={()=>navigate(153)}>查看订单详情 <span>→</span></button><button className="outline-button" onClick={()=>navigate(146)}>继续逛文创商品</button></section>;
  if(id==="GOODS-08"||id==="ORDER-04")return <section className="commerce-page"><CommerceHeader title="文创订单详情" onBack={back}/><div className="order-state"><span>运</span><p><small>当前状态</small><strong>商品已发出</strong><b>预计明天送达</b></p></div><div className="checkout-goods"><span>串</span><p><small>四季能量手串</small><strong>夏长 · 16cm × 1</strong><b>380 ●</b></p></div><div className="order-detail-lines"><p><span>订单编号</span><strong>SC202608050018</strong></p><p><span>兑换时间</span><strong>2026.08.05 14:32</strong></p><p><span>收货地址</span><strong>小满 · 杭州市西湖区</strong></p><p><span>实付</span><strong>380 ●</strong></p></div><button className="primary" onClick={()=>navigate(154)}>查看物流 <span>→</span></button><button className="outline-button" onClick={()=>navigate(155)}>确认收货与售后</button></section>;
  if(id==="GOODS-09")return <section className="commerce-page"><CommerceHeader title="物流信息" onBack={back}/><div className="logistics-head"><span>运</span><p><small>顺丰速运 · SF1234567890</small><strong>运输中</strong><b>预计08月09日送达</b></p></div><div className="logistics-line"><article className="active"><i/><time>今天 09:26</time><strong>快件已到达杭州西湖营业点</strong></article><article><i/><time>昨天 22:18</time><strong>快件离开杭州转运中心</strong></article><article><i/><time>08月06日 16:40</time><strong>商家已发货</strong></article></div><button className="outline-button">复制物流单号</button></section>;
  if(id==="GOODS-10")return <section className="commerce-page"><CommerceHeader title="确认收货与售后" onBack={back}/><div className="received-card"><span>串</span><p><small>四季能量手串</small><strong>商品已签收</strong></p></div><div className="after-sales"><button><i>✓</i><span><strong>确认收货</strong><small>确认商品已完好收到</small></span><b>›</b></button><button onClick={()=>navigate(160)}><i>退</i><span><strong>申请售后</strong><small>质量问题、错发、漏发或其他异常</small></span><b>›</b></button><button><i>评</i><span><strong>留下使用感受</strong><small>分享它如何进入你的日常</small></span><b>›</b></button></div></section>;
  if(id==="ORDER-02")return <section className="commerce-page"><CommerceHeader title="购种订单详情" onBack={back}/><div className="order-state"><span>种</span><p><small>支付成功</small><strong>600颗智慧种子已到账</strong><b>当前余额612颗</b></p></div><div className="order-detail-lines"><p><span>支付金额</span><strong>¥49.9</strong></p><p><span>购买渠道</span><strong>微信站内支付</strong></p><p><span>支付时间</span><strong>2026.08.08 10:26</strong></p><p><span>订单编号</span><strong>SD202608080026</strong></p><p><span>到账状态</span><strong>已完成</strong></p></div><button className="outline-button" onClick={()=>navigate(160)}>对此订单有疑问</button></section>;
  if(id==="ORDER-03")return <section className="commerce-page"><CommerceHeader title="报告兑换订单" onBack={back}/><div className="order-state"><span>情</span><p><small>报告已交付</small><strong>情感关系匹配报告</strong><b>小满 × 周言</b></p></div><div className="order-detail-lines"><p><span>产品类型</span><strong>数字报告</strong></p><p><span>消耗种子</span><strong>6 ●</strong></p><p><span>兑换时间</span><strong>2026.08.07 21:08</strong></p><p><span>交付状态</span><strong>已生成</strong></p><p><span>订单编号</span><strong>RP202608070088</strong></p></div><button className="primary" onClick={()=>navigate(129)}>打开对应报告 <span>→</span></button><button className="outline-button" onClick={()=>navigate(160)}>报告生成或扣种异常</button></section>;
  if(id==="ORDER-05")return <section className="commerce-page"><CommerceHeader title="退款、退种与异常" onBack={back}/><p className="eyebrow">WE WILL TRACE EVERY ORDER</p><h1>选择需要处理的问题</h1><div className="after-sales"><button><i>种</i><span><strong>智慧种子未到账</strong><small>已支付但余额没有更新</small></span><b>›</b></button><button><i>报</i><span><strong>报告生成失败或重复扣种</strong><small>检查任务并按规则自动退回</small></span><b>›</b></button><button><i>物</i><span><strong>文创商品售后</strong><small>质量、物流、错发或退换问题</small></span><b>›</b></button><button><i>退</i><span><strong>退款与退种记录</strong><small>查看处理进度与原路退回情况</small></span><b>›</b></button></div><div className="commerce-rule"><strong>统一处理原则</strong><p>报告和文创兑换异常优先退回智慧种子；现金购种退款按未使用部分与支付渠道规则处理。</p></div><button className="outline-button">联系人工客服</button></section>;
  return <section className="commerce-page"><CommerceHeader title="商城" onBack={back}/><p>页面准备中</p></section>;
}

function GrowthHeader({ title = "成长", onBack }: { title?: string; onBack?: () => void }) {
  return <header className="growth-header">{onBack ? <button className="back-button" onClick={onBack}>←</button> : <Brand compact />}<strong>{title}</strong><button className="growth-message">信<i/></button></header>;
}

function GrowthHome({ name, navigate }: { name: string; navigate: (step: number) => void }) {
  return <section className="growth-page growth-home"><GrowthHeader/><div className="growth-season"><div className="season-orbit"><i/><i/><span>长</span></div><p><small>CURRENT CHAPTER</small><strong>{name || "小满"}，你正在进入<br/>一个重新整理方向的阶段</strong><span>从已有的洞察里，看见下一步</span></p></div><div className="growth-continue"><header><strong>继续进行</strong><button onClick={()=>navigate(95)}>生成任务</button></header><button className="continue-card" onClick={()=>navigate(54)}><i>月</i><span><small>最近阅读 · 今日</small><strong>变化不是在催你离开</strong><p>问事报告已读至 72%</p></span><b>›</b></button></div><section className="deep-reports"><header><strong>深度认识自己</strong><button onClick={()=>navigate(53)}>全部报告</button></header><div><button className="life-entry" onClick={()=>navigate(55)}><i>光</i><span><small>长期生命底图</small><strong>生命之光</strong><p>读懂天赋、关系方式与人生主题</p></span><b>→</b></button><button onClick={()=>navigate(56)}><i>月</i><span><small>本月节律</small><strong>月运与年运</strong><p>看见当下，也看见更长的时间</p></span><b>→</b></button></div></section><div className="growth-glance"><button onClick={()=>navigate(53)}><span>册</span><p><strong>我的报告</strong><small>7 份内容 · 1 份生成中</small></p><b>›</b></button><button onClick={()=>navigate(96)}><span>迹</span><p><strong>成长时间线</strong><small>从洞察走向真实改变</small></p><b>›</b></button></div><div className="recent-insight"><small>最近看见</small><p>“方向不是在焦虑中想出来的，而是在一次次诚实选择里逐渐清晰。”</p><span>来自 · 工作变化问事</span></div><MainNav active="成长" navigate={navigate}/></section>;
}

function GrowthEmpty({ onBack, onLife }: { onBack: () => void; onLife: () => void }) {
  return <section className="growth-page growth-empty"><GrowthHeader onBack={onBack}/><div className="empty-garden"><span>●</span><i/><i/><b/></div><p className="eyebrow">YOUR GROWTH BEGINS HERE</p><h1>你的成长故事<br/>正准备开始</h1><p className="growth-lead">生命智慧档案已经建立。第一份深度报告，会成为理解自己与记录变化的起点。</p><div className="empty-path"><span><b>01</b>认识自己的长期生命底图</span><span><b>02</b>在每一天与每个月持续验证</span><span><b>03</b>把真实发生的改变留在时间线</span></div><button className="primary" onClick={onLife}>生成我的生命之光 <span>→</span></button><button className="text-action" onClick={onBack}>先看看成长首页</button></section>;
}

function GrowthLibrary({ onBack, onOpen }: { onBack: () => void; onOpen: () => void }) {
  const [filter,setFilter]=useState("全部");
  const [searching,setSearching]=useState(false);const [query,setQuery]=useState("");
  const reports=[["生命之光","你的天赋与人生剧本","生命档案","已完成"],["今日指引","先稳住自己，再回应世界","日签","今天"],["问事报告","面对工作变化，如何找到自己的位置","问事","昨天"],["八月月运","看见本月的重点与行动","周期","生成中"]];
  const visible=reports.filter(x=>(filter==="全部"||filter==="每日与周期"&&["今日指引","八月月运"].includes(x[0])||x[0].includes(filter.replace("问事","问事报告")))&&(!query||x[1].includes(query)||x[0].includes(query)));
  return <section className="growth-page growth-library"><GrowthHeader title="我的报告" onBack={onBack}/><div className="library-summary"><span><small>正式报告</small><strong>7</strong></span><p>所有报告只保存一份<br/><b>不同入口指向同一内容</b></p></div>{searching&&<label className="library-search-field">⌕<input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="输入报告名称或关键词"/><button onClick={()=>{setSearching(false);setQuery("")}}>取消</button></label>}<div className="library-filters">{["全部","生命之光","每日与周期","问事","关系"].map(x=><button className={filter===x?"active":""} onClick={()=>setFilter(x)} key={x}>{x}</button>)}</div><div className="growth-report-list">{visible.map(([type,title,source,status])=><button onClick={onOpen} key={title} className={status==="生成中"?"generating":""}><i>{type==="生命之光"?"光":type==="今日指引"?"日":type==="问事报告"?"问":"月"}</i><span><small>{source}</small><strong>{title}</strong><p>{type}</p></span><b>{status}</b></button>)}</div>{visible.length===0&&<div className="prototype-empty">没有找到相关报告，试试其他关键词</div>}<button className="library-search" onClick={()=>setSearching(true)}>⌕　搜索我的全部报告</button></section>;
}

function GrowthReportSummary({ onBack,onRead,onAction }: { onBack: () => void;onRead:()=>void;onAction:()=>void }) {
  const [version,setVersion]=useState(false);
  return <section className="growth-page growth-summary"><GrowthHeader title="报告摘要" onBack={onBack}/><div className="summary-cover"><small>ASK · DRAW · REFLECT</small><span>问</span><h1>变化不是在催你离开<br/>而是在邀请你重新选择</h1><p>事业 · 双卡问事 · 昨天</p></div><div className="summary-key"><small>这一份报告想让你看见</small><p>你不需要立刻做出决定。此刻更重要的是，先辨认哪些变化值得回应，哪些只是外界的噪声。</p></div><div className="summary-actions"><button onClick={onRead}><i>读</i><span><strong>继续阅读全文</strong><small>上次读至 72%</small></span><b>›</b></button><button onClick={onAction}><i>行</i><span><strong>带走一个行动</strong><small>写下想保留、放下与验证的事</small></span><b>›</b></button></div><div className="summary-source"><span>报告来源</span><strong>工作变化问事 · 辛巳 × 甲子</strong><button onClick={()=>setVersion(v=>!v)}>{version?"收起依据":"查看依据与版本"}</button></div>{version&&<div className="version-panel"><p><span>卡牌依据</span><strong>辛巳 × 甲子</strong></p><p><span>报告版本</span><strong>问事报告 V1.0</strong></p><p><span>生成时间</span><strong>2026.08.07 21:08</strong></p></div>}<button className="primary" onClick={onRead}>继续阅读全文 <span>→</span></button></section>;
}

function LifeLightIntro({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return <section className="growth-page life-intro"><GrowthHeader title="生命之光" onBack={onBack}/><div className="life-light"><div><i/><i/><i/><i/><span>光</span></div></div><p className="eyebrow">THE LIGHT WITHIN YOU</p><h1>看见你的天赋<br/>与人生剧本</h1><p className="growth-lead">从四张关系卡牌出发，理解你的生命底色、关系方式、内在动力与持续成长的方向。</p><div className="life-chapters"><span><b>01</b>你的生命底色与四季能量</span><span><b>02</b>四张关系卡牌如何共同作用</span><span><b>03</b>天赋、惯性与反复出现的主题</span><span><b>04</b>事业、家庭、关系与自我</span><span><b>05</b>适合你的成长方向</span></div><div className="life-delivery"><span><small>预计阅读</small><strong>20—30 分钟</strong></span><span><small>报告形式</small><strong>完整深度报告</strong></span></div><button className="primary" onClick={onNext}>开始生成生命之光 <span>→</span></button><p className="safe-copy">报告默认仅自己可见，生成前会再次确认档案与智慧种子</p></section>;
}

function LifeArchiveConfirm({ onBack, onNext,onDetails,onEdit }: { onBack: () => void; onNext: () => void;onDetails:()=>void;onEdit:()=>void }) {
  const cards=[["时空关系","庚午","sunset"],["事业关系","辛巳","forest"],["家庭关系","甲子","water"],["自我关系","戊辰","earth"]];
  return <section className="growth-page life-confirm"><GrowthHeader title="确认生命智慧档案" onBack={onBack}/><p className="eyebrow">THE SOURCE OF YOUR REPORT</p><h1>这份报告，将从<br/>你的四张关系卡牌出发</h1><p className="growth-lead">请确认这次使用的档案。报告生成后会保留当前版本，不会因以后修改资料而悄悄变化。</p><div className="life-owner"><span>小</span><p><strong>小满的生命智慧档案</strong><small>当前版本 V1 · 创建于 2026.08.06</small></p><button onClick={onDetails}>查看详情</button></div><div className="life-card-row">{cards.map(([name,mark,tone])=><article className={tone} key={name}><small>{name}</small><i/><strong>{mark}</strong></article>)}</div><div className="archive-facts"><p><span>出生日期</span><strong>1990.05.18</strong></p><p><span>出生时间</span><strong>08:30 · 准确到分钟</strong></p><p><span>出生地点</span><strong>杭州市 · 浙江省</strong></p></div><div className="privacy-inline"><span className="lock"/><p>出生资料仅用于生成本人报告，默认不会出现在分享内容中。</p></div><button className="primary" onClick={onNext}>确认使用这份档案 <span>→</span></button><button className="text-action" onClick={onEdit}>出生资料有变化，先去修改</button></section>;
}

function LifeDeliveryPreview({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const chapters=[["01","生命底色","四季能量与整体气质"],["02","四张关系卡牌","时空、事业、家庭与自我"],["03","天赋与内在动力","你自然擅长与持续被推动的事"],["04","关系与人生模式","反复出现的选择、惯性与课题"],["05","成长方向","把看见带回真实生活"]];
  return <section className="growth-page life-preview"><GrowthHeader title="报告内容" onBack={onBack}/><div className="preview-book"><i/><span>光</span><small>生命之光</small></div><p className="eyebrow">WHAT YOU WILL RECEIVE</p><h1>这不是一个标签<br/>而是一份理解自己的地图</h1><div className="preview-chapters">{chapters.map(([n,title,note])=><article key={n}><b>{n}</b><span><strong>{title}</strong><small>{note}</small></span><i>›</i></article>)}</div><div className="delivery-note"><span><small>完整报告</small><strong>5 个主题篇章</strong></span><span><small>预计阅读</small><strong>20—30 分钟</strong></span><span><small>交付位置</small><strong>成长 · 我的报告</strong></span></div><p className="life-boundary">报告用于自我理解与成长陪伴，不替代医疗、心理、法律和财务等专业意见。</p><button className="primary" onClick={onNext}>确认内容，继续 <span>→</span></button></section>;
}

function LifeSeedConfirm({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [rules,setRules]=useState(false);
  return <section className="growth-page life-payment"><GrowthHeader title="确认生成" onBack={onBack}/><div className="life-seed-scene"><i/><i/><span>●</span><b>光</b></div><p className="eyebrow">PLANT FOR A DEEPER VIEW</p><h1>种下一些智慧<br/>让报告慢慢长出来</h1><div className="life-order"><small>本次交付</small><h2>生命之光 · 你的天赋与人生剧本</h2><p>使用生命智慧档案 V1</p><div><span>报告内容</span><strong>5 个主题篇章</strong></div><div><span>所需智慧种子</span><strong className="seed-cost">12 ●</strong></div></div><div className="balance-change"><span>当前余额 <b>20</b></span><i>→</i><span>完成后 <b>8</b></span></div><div className="seed-protection"><span>护</span><p><strong>种子只在报告任务成功建立后扣除</strong>如果生成失败且没有形成有效报告，将自动退回。</p></div><button className="primary" onClick={onNext}>确认并种下 12 颗智慧种子 <span>→</span></button><button className="text-action" onClick={()=>setRules(v=>!v)}>{rules?"收起使用规则":"查看智慧种子使用规则"}</button>{rules&&<div className="version-panel"><strong>扣除与退回规则</strong><p>任务成功建立后扣除 12 颗；失败且未生成有效报告时自动退回，记录可在“我的智慧种子”中查询。</p></div>}</section>;
}

function LifeGenerating({ onBack, onNext, onLeave }: { onBack: () => void; onNext: () => void; onLeave: () => void }) {
  return <section className="growth-page life-generating"><GrowthHeader title="正在生成" onBack={onBack}/><div className="life-tree"><div className="tree-light"/><i className="trunk"/><i className="branch a"/><i className="branch b"/><span>光</span><b/><b/></div><p className="eyebrow">YOUR LIGHT IS GROWING</p><h1>正在把四张卡牌<br/>读成属于你的生命地图</h1><div className="life-progress"><span className="done">✓ 连接生命智慧档案与四张卡牌</span><span className="done">✓ 理解四季能量与整体气质</span><span className="active">· 整理天赋、关系与人生主题</span><span>· 长成完整生命之光报告</span></div><p className="generate-away">预计需要几分钟。可以先离开，完成后会在消息中心提醒你。</p><button className="text-action" onClick={onNext}>原型中直接查看报告 →</button><button className="outline-button" onClick={onLeave}>先离开，完成后提醒我</button></section>;
}

function LifeSummary({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return <section className="growth-page life-summary"><GrowthHeader title="生命之光" onBack={onBack}/><div className="light-cover"><small>THE LIGHT WITHIN YOU</small><div><i/><i/><i/><i/><span>光</span></div><h1>你不是急着找到答案的人<br/>你更擅长让答案慢慢长出来</h1><p>小满的生命之光 · 档案 V1</p></div><section className="life-first-feel"><small>先让你找到感觉</small><p>你身上同时有向外展开的力量，也有向内沉静的需要。真正适合你的节奏，不是一直向前，而是在行动与整理之间找到自己的呼吸。</p></section><div className="talent-chips"><small>你自然携带的三种力量</small><div><span>看见关系</span><span>重新开始</span><span>在变化中选择</span></div></div><div className="four-voices"><small>四张卡牌想对你说</small><p><b>时空关系</b><span>你需要在更大的变化里辨认自己的位置。</span></p><p><b>事业关系</b><span>真正的推进来自聚焦，而不是同时抓住所有机会。</span></p><p><b>家庭关系</b><span>允许自己回到内心，再决定如何回应亲近的人。</span></p><p><b>自我关系</b><span>稳定不是停下，而是为下一次生长保存力量。</span></p></div><button className="primary" onClick={onNext}>阅读完整生命之光 <span>→</span></button></section>;
}

function LifeFullReport({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const sections=[["01 · 你的生命底色","你既能感受到外部世界的变化，也会不断回到内心确认：这是不是我真正想走的方向。你的力量并不来自持续用力，而来自在变化里仍然能够辨认自己。"],["02 · 四种关系如何共同作用","面对世界时，你愿意向外理解环境；面对事业时，你需要清晰的价值与秩序；回到家庭和自我时，你又需要安静、真实与可以重新整理的空间。"],["03 · 你的天赋与内在动力","你擅长看见事物之间的联系，也能够在混乱中重新组织意义。当你不再急着证明自己，这份理解力会自然成为影响他人的力量。"],["04 · 反复出现的人生主题","你可能会在“继续坚持”与“重新选择”之间反复思考。真正的课题并不是选得绝对正确，而是每一次选择都更接近真实的自己。"],["05 · 适合你的成长方向","为自己保留观察和整理的时间，再选择一个足够小的现实行动。成长不需要一次完成，它会在每一次诚实回应里逐渐显现。"]];
  const [chapter,setChapter]=useState(0); const [saved,setSaved]=useState<number[]>([]); const [chat,setChat]=useState(false);
  return <section className="growth-page life-report"><GrowthHeader title="完整报告" onBack={onBack}/><div className="report-progress"><span>生命之光</span><strong>{chapter+1} / 5</strong><i><b style={{width:`${(chapter+1)*20}%`}}/></i></div><div className="life-report-scroll"><div className="report-opening"><small>小满 · 生命智慧档案 V1</small><h1>你的天赋与人生剧本</h1><p>愿这份报告不是替你定义人生，而是在你需要的时候，帮你更清楚地看见自己。</p></div>{sections.map(([title,body],i)=><article className={chapter===i?"open":""} key={title}><button onClick={()=>setChapter(i)}><span>{title}</span><b>{chapter===i?"−":"+"}</b></button>{chapter===i&&<div><p>{body}</p><blockquote>“你不必一下子成为谁，只需要一次比一次更诚实地回应自己。”</blockquote><button className="chapter-save" onClick={()=>setSaved(v=>v.includes(i)?v.filter(n=>n!==i):[...v,i])}>{saved.includes(i)?"♥ 已收藏":"♡ 收藏这一段"}</button></div>}</article>)}<div className="report-ending"><span>光</span><h2>写给此刻的你</h2><p>你已经走过的路并没有白费。那些停顿、犹豫与重新选择，都在帮你长成更了解自己的人。</p></div><button className="primary" onClick={onNext}>生成生命之光分享卡 <span>→</span></button><button className="text-action" onClick={()=>setChat(true)}>带着这份报告继续聊聊</button>{chat&&<div className="prototype-toast">已将这份报告加入智能陪伴上下文</div>}</div></section>;
}

function LifeShare({ onBack, onHome }: { onBack: () => void; onHome: () => void }) {
  const [saved,setSaved]=useState(false); const [style,setStyle]=useState("生命绿"); const [shared,setShared]=useState(false);
  return <section className="growth-page life-share"><GrowthHeader title="分享生命之光" onBack={onBack}/><p className="eyebrow">SHARE YOUR LIGHT</p><h1>分享这一刻的看见<br/>不暴露你的出生资料</h1><div className={`life-share-card ${style==="暖金"?"gold":""}`}><small>MY INNER LIGHT</small><div><span>光</span><i/><i/></div><p>你不是急着找到答案的人<br/><strong>你更擅长让答案慢慢长出来</strong></p><footer>身心游 · SATORI</footer></div><div className="share-style"><small>选择卡片氛围</small><div>{["生命绿","暖金"].map(x=><button className={style===x?"active":""} onClick={()=>setStyle(x)} key={x}>{x}</button>)}</div></div><div className="share-privacy-check"><span>✓</span><p><strong>已自动隐藏敏感信息</strong>不展示出生日期、时间、地点和四张卡牌原文。</p></div><div className="ready-actions"><button onClick={()=>setSaved(true)}><i>↓</i><span><strong>保存图片</strong><small>{saved?"已保存到相册":"高清分享图"}</small></span></button><button onClick={()=>setShared(true)}><i>↗</i><span><strong>系统分享</strong><small>{shared?"分享菜单已唤起":"打开手机分享菜单"}</small></span></button></div><button className="primary" onClick={onHome}>完成，回到成长首页 <span>→</span></button></section>;
}

function PeriodHub({ onBack, onMonthly, onAnnual, onHistory }: { onBack: () => void; onMonthly: () => void; onAnnual: () => void; onHistory: () => void }) {
  return <section className="growth-page period-hub"><GrowthHeader title="周期报告" onBack={onBack}/><div className="period-now"><small>此刻所在的周期</small><h1>2026年 · 八月</h1><p>8月7日—9月6日 · Asia/Shanghai</p><div><span><i/>月运看本月的重点与行动</span><span><i/>年运看全年的结构与阶段</span></div></div><div className="period-entries"><button onClick={onMonthly} className="monthly"><span>月</span><div><small>MONTHLY GUIDANCE</small><strong>八月月运</strong><p>整体全面版与五类专项</p></div><b>→</b></button><button onClick={onAnnual} className="annual"><span>年</span><div><small>ANNUAL MAP</small><strong>2026 年度地图</strong><p>四季节奏与十二个月索引</p></div><b>→</b></button></div><div className="period-explain"><strong>不同时间尺度，回答不同问题</strong><p><b>日签</b>看今天的一步　·　<b>月运</b>看本月重点<br/><b>年运</b>看全年结构　·　<b>回顾</b>看真实发生</p></div><button className="text-action" onClick={onHistory}>查看我的周期报告历史</button></section>;
}

function MonthlyProducts({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [selected,setSelected]=useState("整体月运");
  const products=[["整体月运","全","五大领域全景与跨领域优先级","全面"],["健康与身心","康","精力、恢复与自我关照","专项"],["财富与资源","财","预算、资源与现金流意识","专项"],["情感与关系","情","表达、边界与关系节奏","专项"],["个人状态","心","情绪、动力与内在节奏","专项"],["事业与推进","业","任务、协作与推进节奏","专项"]];
  return <section className="growth-page monthly-products"><GrowthHeader title="八月月运" onBack={onBack}/><p className="eyebrow">CHOOSE WHAT YOU NEED</p><h1>这个月，你想先<br/>看见什么？</h1><p className="growth-lead">整体版覆盖五大领域；每一份专项也可以独立生成，不需要先购买整体版。</p><div className="monthly-grid">{products.map(([name,icon,note,type])=><button className={selected===name?"active":""} onClick={()=>setSelected(name)} key={name}><i>{icon}</i><small>{type}</small><strong>{name}</strong><p>{note}</p><b>{selected===name?"✓":""}</b></button>)}</div><div className="monthly-choice"><span>当前选择</span><strong>{selected}</strong><small>下一步查看报告结构与交付边界</small></div><button className="primary" onClick={onNext}>了解{selected} <span>→</span></button></section>;
}

function MonthlyIntro({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){return <section className="growth-page month-detail"><GrowthHeader title="整体月运 · 全面版" onBack={onBack}/><div className="month-hero"><span>八月</span><small>2026.08.07—09.06</small><h1>先看见整个月<br/>再安排每一步</h1></div><p className="growth-lead">整体版不是五份专项的预告，而是一份可以独立完成交付的全景报告。</p><div className="month-structure">{[["01","看见这个月","整体意象、周期边界与前后半月"],["02","五大领域全景","健康、财富、情感、个人状态、事业"],["03","领域如何相互影响","找到真正值得优先处理的事"],["04","本月优先级","知道什么先做、什么暂缓"],["05","行动与回顾","带走一至三项现实行动"]].map(x=><p key={x[0]}><b>{x[0]}</b><span><strong>{x[1]}</strong><small>{x[2]}</small></span></p>)}</div><div className="month-boundary">整体版已经正式覆盖五个领域，不需要再购买专项才能看到结论；专项用于进一步深入一个领域。</div><button className="primary" onClick={onNext}>选择整体月运 · 全面版 <span>→</span></button></section>}

function MonthlyArchive({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){return <section className="growth-page month-confirm"><GrowthHeader title="确认生命智慧档案" onBack={onBack}/><p className="eyebrow">PROFILE FOR THIS MONTH</p><h1>确认本次月运<br/>从哪一份档案出发</h1><div className="month-profile"><span>小</span><p><strong>小满的生命智慧档案</strong><small>版本 V1 · 四张关系卡牌已确认</small></p><b>当前</b></div><div className="mini-four">{[["时空","庚午"],["事业","辛巳"],["家庭","甲子"],["自我","戊辰"]].map(x=><span key={x[0]}><small>{x[0]}</small><strong>{x[1]}</strong></span>)}</div><div className="archive-facts"><p><span>出生资料</span><strong>1990.05.18 · 08:30</strong></p><p><span>出生地点</span><strong>杭州市 · 浙江省</strong></p><p><span>档案状态</span><strong>有效，可用于生成</strong></p></div><div className="seed-protection"><span>版</span><p><strong>生成后保留本次档案版本</strong>以后修改出生资料，不会悄悄改变已经完成的月运。</p></div><button className="primary" onClick={onNext}>确认使用档案 V1 <span>→</span></button></section>}

function MonthlyPeriod({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){return <section className="growth-page month-period"><GrowthHeader title="确认月运周期" onBack={onBack}/><div className="period-wheel"><span>八月</span><i>前</i><i>后</i></div><p className="eyebrow">THE MONTH HAS ITS OWN RHYTHM</p><h1>这份月运覆盖的<br/>不是简单的自然月</h1><div className="period-card"><small>2026年八月月运</small><h2>8月7日—9月6日</h2><p>Asia/Shanghai · 当前历法版本</p><div><span><b>前半月</b>8月7日—8月22日</span><span><b>后半月</b>8月23日—9月6日</span></div></div><p className="period-copy">旅行或临时更换所在地不会重算周期边界；报告会记录本次使用的日期、时区和历法版本。</p><button className="primary" onClick={onNext}>确认周期，继续 <span>→</span></button></section>}

function MonthlyPayment({onBack,onNext,onBundle}:{onBack:()=>void;onNext:()=>void;onBundle:()=>void}){return <section className="growth-page month-pay"><GrowthHeader title="确认生成" onBack={onBack}/><div className="pay-moon"><span>月</span><i/><i/></div><p className="eyebrow">CONFIRM & PLANT</p><h1>确认本月想看见的<br/>完整内容</h1><div className="life-order"><small>本次交付</small><h2>八月整体月运 · 全面版</h2><p>2026.08.07—09.06 · 档案 V1</p><div><span>覆盖内容</span><strong>五大领域＋综合行动</strong></div><div><span>智慧种子</span><strong className="seed-cost">8 ●</strong></div></div><div className="balance-change"><span>当前余额 <b>20</b></span><i>→</i><span>完成后 <b>12</b></span></div><button className="bundle-link" onClick={onBundle}>想同时获得专项？比较组合方式 →</button><div className="seed-protection"><span>护</span><p><strong>不会重复扣费</strong>任务失败且没有形成有效报告，将自动退回智慧种子。</p></div><button className="primary" onClick={onNext}>确认并种下 8 颗智慧种子 <span>→</span></button></section>}

function MonthlyGenerating({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){return <section className="growth-page month-generating"><GrowthHeader title="正在生成八月月运" onBack={onBack}/><div className="moon-grow"><span>月</span><i/><i/><b/><b/></div><p className="eyebrow">READING THIS MONTH</p><h1>正在理解这个月<br/>与你的关系</h1><div className="life-progress"><span className="done">✓ 确认月运边界与档案版本</span><span className="done">✓ 整理前半月与后半月节奏</span><span className="active">· 连接健康、财富、情感与事业</span><span>· 形成综合优先级与行动</span></div><p className="generate-away">可以先离开，完成后会在消息中心提醒你。</p><button className="text-action" onClick={onNext}>原型中直接查看月运中心 →</button><button className="outline-button">先离开，完成后提醒我</button></section>}

function MonthlyCenter({onBack,openOverall,openSpecial,onBundle}:{onBack:()=>void;openOverall:()=>void;openSpecial:(i:number)=>void;onBundle:()=>void}){const [version,setVersion]=useState(false);const items=[["健康与身心","康","未生成"],["财富与资源","财","未生成"],["情感与关系","情","已拥有"],["个人状态","心","未生成"],["事业与推进","业","未生成"]];return <section className="growth-page month-center"><GrowthHeader title="八月月运中心" onBack={onBack}/><div className="month-center-head"><small>2026.08.07—09.06</small><h1>这个月，先稳住节奏<br/>再选择真正重要的事</h1><p>整体月运已完成 · 档案 V1</p></div><button className="overall-card" onClick={openOverall}><span>全</span><div><small>整体月运 · 全面版</small><strong>五大领域全景已经长好</strong><p>前后半月 · 跨领域重点 · 本月行动</p></div><b>已完成 ›</b></button><div className="special-title"><strong>五类专项</strong><button onClick={onBundle}>组合获得</button></div><div className="special-list">{items.map((x,i)=><button onClick={()=>openSpecial(i)} key={x[0]}><i>{x[1]}</i><span><strong>{x[0]}</strong><small>深入一个领域的场景与行动</small></span><b>{x[2]} ›</b></button>)}</div><button className="text-action" onClick={()=>setVersion(v=>!v)}>{version?"收起报告依据":"查看本月报告依据与版本"}</button>{version&&<div className="version-panel"><strong>本次报告版本</strong><p>周期：2026.08.07—09.06 · 档案 V1 · 生成于 08.08 10:26。历史报告不会因后续规则更新而变化。</p></div>}</section>}

function MonthlySummary({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){return <section className="growth-page month-summary"><GrowthHeader title="八月整体月运" onBack={onBack}/><div className="month-summary-cover"><small>2026.08.07—09.06</small><span>中</span><h1>先整理内在节奏<br/>再推动外部变化</h1><p>前半月适合辨认重点 · 后半月适合稳步推进</p></div><div className="half-month"><span><small>前半月</small><strong>收拢与辨认</strong><p>先减少噪声，确认真正值得投入的方向。</p></span><span><small>后半月</small><strong>连接与推进</strong><p>把已经确认的重点带回现实安排。</p></span></div><div className="five-glance">{[["康","健康","别把恢复排在所有事情之后"],["财","财富","先整理资源，再考虑扩张"],["情","情感","表达需要，也给彼此空间"],["心","状态","专注比同时回应更重要"],["业","事业","从一个关键任务开始推进"]].map(x=><p key={x[1]}><i>{x[0]}</i><span><strong>{x[1]}</strong><small>{x[2]}</small></span></p>)}</div><div className="priority-note"><small>本月最值得优先</small><p>减少同时推进的事情，把精力留给一个真正重要的方向。</p></div><button className="primary" onClick={onNext}>阅读完整月运报告 <span>→</span></button></section>}

function MonthlyFullReport({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){const [open,setOpen]=useState(0);const [shared,setShared]=useState(false);const parts=[["01 · 看见这个月","这个月的重点并不是做得更多，而是重新确认精力、关系与现实安排之间的顺序。"],["02 · 五大领域全景","健康需要恢复，财富需要整理，情感需要真实表达，个人状态需要聚焦，事业需要稳步推进。"],["03 · 领域之间的影响","当内在节奏被过多事情打散，事业推进和关系表达都会变得急促；先恢复清晰，外部动作会更有力量。"],["04 · 本月优先级","优先完成一个真正重要的任务，暂缓低价值消耗，并为恢复留出固定空间。"],["05 · 综合行动与回顾","选择一至三项足够小的行动，在月末根据真实结果重新理解这份报告。"]];return <section className="growth-page month-report"><GrowthHeader title="完整月运报告" onBack={onBack}/><div className="month-report-intro"><span>月</span><small>八月整体月运 · 全面版</small><h1>先整理内在节奏<br/>再推动外部变化</h1></div><div className="month-report-sections">{parts.map((x,i)=><article key={x[0]} className={open===i?"open":""}><button onClick={()=>setOpen(i)}><strong>{x[0]}</strong><b>{open===i?"−":"+"}</b></button>{open===i&&<div><p>{x[1]}</p><blockquote>把这段话带回真实生活，再决定它是否适合你。</blockquote></div>}</article>)}</div><button className="primary" onClick={onNext}>选择本月行动 <span>→</span></button><button className="text-action" onClick={()=>setShared(v=>!v)}>{shared?"收起月运分享卡":"生成月运分享卡"}</button>{shared&&<div className="period-share-preview"><small>2026 · 八月月运</small><strong>先整理内在节奏，再推动外部变化</strong><span>已隐藏出生资料与卡牌信息</span></div>}</section>}

function MonthlyActions({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){const options=["每天只保留一个最重要任务","每周安排两次不被打扰的恢复时间","在重要沟通前先写下自己的真实需要","本月暂缓一项低价值消耗"];const [picked,setPicked]=useState([options[0]]);const [reminder,setReminder]=useState("未设置");const toggle=(x:string)=>setPicked(p=>p.includes(x)?p.filter(v=>v!==x):p.length<3?[...p,x]:p);return <section className="growth-page month-actions"><GrowthHeader title="选择本月行动" onBack={onBack}/><p className="eyebrow">TURN INSIGHT INTO LIFE</p><h1>这个月，最多带走<br/>三件真正做得到的事</h1><p className="growth-lead">行动不是对报告的服从，而是你愿意在真实生活里尝试的验证。</p><div className="action-counter"><span>已选择</span><strong>{picked.length} / 3</strong></div><div className="month-action-list">{options.map(x=><button className={picked.includes(x)?"active":""} onClick={()=>toggle(x)} key={x}><i>{picked.includes(x)?"✓":""}</i><span>{x}</span></button>)}</div><div className="action-reminder"><span>醒</span><p><strong>轻提醒，而不是催促</strong>可以设置每周一次回看，随时修改、暂停或放弃。</p><button onClick={()=>setReminder(v=>v==="未设置"?"每周日":"未设置")}>{reminder==="未设置"?"设置":reminder}</button></div>{reminder!=="未设置"&&<div className="prototype-toast">✓ 已设置每周日回看提醒，可随时关闭</div>}<button className="primary" onClick={onNext}>保存行动，月末回来看看 <span>→</span></button></section>}

function MonthlyReview({onBack,onHome}:{onBack:()=>void;onHome:()=>void}){const [feeling,setFeeling]=useState("更了解自己");return <section className="growth-page month-review"><GrowthHeader title="八月回顾" onBack={onBack}/><div className="review-moon"><span>月</span><i/><i/></div><p className="eyebrow">WHAT REALLY HAPPENED</p><h1>不判断月运准不准<br/>只看看真实发生了什么</h1><div className="review-stats"><span><small>选择行动</small><strong>2</strong></span><span><small>完成</small><strong>1</strong></span><span><small>仍在进行</small><strong>1</strong></span></div><div className="review-feeling"><strong>这个月，你更接近哪种感受？</strong><div>{["更了解自己","有新的变化","仍需要时间","和预期不同"].map(x=><button className={feeling===x?"active":""} onClick={()=>setFeeling(x)} key={x}>{x}</button>)}</div><textarea placeholder="写下这个月真正发生的一件事…"/></div><label className="timeline-switch"><span><strong>保存到成长时间线</strong><small>只保存你确认的回顾与行动结果</small></span><input type="checkbox" defaultChecked/></label><button className="primary" onClick={onHome}>完成回顾，回到成长首页 <span>→</span></button></section>}

function MonthlySpecial({type,tone,onBack}:{type:string;tone:string;onBack:()=>void}){const lines:{[k:string]:string[] }={"健康与身心关照":["精力与恢复节奏","压力、休息与睡眠观察","前后半月的自我关照","何时寻求专业帮助"],"财富与资源":["预算与现金流意识","资源安排与重大支出检查","前后半月的财务关注","用真实数据验证决定"],"情感与关系":["表达、回应与边界","单身或亲密关系可选路径","前后半月的沟通节奏","不操控他人的关系行动"],"个人状态":["情绪、动力与专注","压力中的自我观察","前后半月的决策节奏","恢复与自我支持行动"],"事业与推进":["任务优先级与推进节奏","协作、沟通与资源安排","前后半月的工作重点","一至三项现实行动"]};return <section className="growth-page special-report"><GrowthHeader title={`月运 · ${type}`} onBack={onBack}/><div className="special-cover"><span>{tone}</span><small>八月专项报告</small><h1>{type}</h1><p>2026.08.07—09.06</p></div><div className="special-theme"><small>本月专项主题</small><h2>先照顾好节奏，再回应这个领域里的变化</h2><p>专项会使用与整体月运相同的月度基础，但只深入与你选择的领域有关的场景和行动。</p></div><div className="special-sections">{lines[type].map((x,i)=><p key={x}><b>0{i+1}</b><span><strong>{x}</strong><small>{i===0?"总体主题与档案关联":i===1?"支持、卡点与现实场景":i===2?"看见节奏如何变化":"带走低风险、可验证的行动"}</small></span><i>›</i></p>)}</div><div className="month-boundary">专项内容用于自我观察，不提供医疗诊断、投资指令、他人心理推测或结果预测。</div><button className="primary">生成这份专项报告 <span>→</span></button></section>}

function MonthlyBundle({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){const [items,setItems]=useState(["情感与关系","事业与推进"]);const all=["健康与身心","财富与资源","情感与关系","个人状态","事业与推进"];const toggle=(x:string)=>setItems(p=>p.includes(x)?p.filter(v=>v!==x):[...p,x]);return <section className="growth-page month-bundle"><GrowthHeader title="月运组合方式" onBack={onBack}/><p className="eyebrow">CHOOSE WITHOUT PAYING TWICE</p><h1>只为真正需要的内容<br/>种下智慧种子</h1><div className="owned-overall"><span>✓</span><p><strong>整体月运 · 全面版已拥有</strong><small>组合不会重复收取整体版费用</small></p></div><div className="bundle-options">{all.map(x=><button className={items.includes(x)?"active":""} onClick={()=>toggle(x)} key={x}><i>{items.includes(x)?"✓":""}</i><span>{x}</span><b>4 ●</b></button>)}</div><div className="bundle-total"><p><span>已选专项</span><strong>{items.length} 份</strong></p><p><span>单项合计</span><strong>{items.length*4} ●</strong></p><p className="saving"><span>组合抵扣</span><strong>-{items.length>1?2:0} ●</strong></p><p><span>最终需要</span><strong>{Math.max(0,items.length*4-(items.length>1?2:0))} ●</strong></p></div><p className="life-boundary">页面会明确列出实际包含的报告；已经拥有的专项也不会再次收费。</p><button className="primary" onClick={onNext}>确认组合，返回结算 <span>→</span></button></section>}

function AnnualIntro({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return <section className="growth-page annual-intro"><GrowthHeader title="年度地图" onBack={onBack}/><div className="annual-orbit"><span>2026</span>{["春","夏","秋","冬"].map(x=><i key={x}>{x}</i>)}</div><p className="eyebrow">YOUR YEAR IN SEASONS</p><h1>先看见一整年<br/>再走好每一个月</h1><p className="growth-lead">年运不是十二份月运，也不为月份打吉凶分数。它帮助你理解全年结构、四季节奏与值得提前规划的阶段。</p><div className="annual-will-get"><strong>你将获得</strong><span><b>01</b>年度一句话主题与主要阶段</span><span><b>02</b>四季节奏和十二个月索引</span><span><b>03</b>事业、关系、财务与身心视角</span><span><b>04</b>最多三个年度关注方向</span></div><div className="annual-boundary"><span>月</span><p><strong>进入某个月后仍可生成正式月运</strong>年度索引看它在全年中的位置，正式月运提供当月更完整的分析。</p></div><button className="primary" onClick={onNext}>查看 2026 年运详情 <span>→</span></button></section>;
}

function AnnualArchive({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){const [year,setYear]=useState(2026);return <section className="growth-page annual-page"><GrowthHeader title="确认年度与档案" onBack={onBack}/><p className="eyebrow">YOUR YEAR · YOUR PROFILE</p><h1>先确认要看哪一年<br/>以及从哪份档案出发</h1><div className="year-picker"><button onClick={()=>setYear(y=>Math.max(2024,y-1))}>‹</button><span><small>目标年度</small><strong>{year}</strong>{year===2026&&<b>当前年度</b>}</span><button onClick={()=>setYear(y=>Math.min(2030,y+1))}>›</button></div><div className="month-profile"><span>小</span><p><strong>小满的生命智慧档案</strong><small>版本 V1 · 四张关系卡牌已确认</small></p><b>当前</b></div><div className="archive-facts"><p><span>出生资料</span><strong>1990.05.18 · 08:30</strong></p><p><span>出生地点</span><strong>杭州市 · 浙江省</strong></p><p><span>档案状态</span><strong>有效，可用于生成</strong></p></div><div className="seed-protection"><span>版</span><p><strong>报告保留本次档案与知识版本</strong>以后更新资料不会悄悄修改已经完成的年运。</p></div><button className="primary" onClick={onNext}>确认 {year} 年与档案 V1 <span>→</span></button></section>}

function AnnualPeriod({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){return <section className="growth-page annual-page annual-cycle"><GrowthHeader title="确认年度范围" onBack={onBack}/><div className="year-ring"><span>2026</span>{["春","夏","秋","冬"].map(x=><i key={x}>{x}</i>)}</div><p className="eyebrow">A YEAR HAS ITS OWN MAP</p><h1>年度地图使用同一套<br/>明确的周期边界</h1><div className="period-card"><small>2026 年运</small><h2>全年周期地图</h2><p>Asia/Shanghai · 当前历法版本</p><div><span><b>四季节奏</b>组织全年阶段</span><span><b>十二月索引</b>连接正式月运</span></div></div><div className="annual-boundary"><span>界</span><p><strong>月份索引不等于十二份月运</strong>年运提供全年视角；进入当月后可以生成粒度更细的正式月运。</p></div><button className="primary" onClick={onNext}>确认年度范围 <span>→</span></button></section>}

function AnnualPayment({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){return <section className="growth-page annual-page annual-pay"><GrowthHeader title="确认生成" onBack={onBack}/><div className="pay-year"><span>年</span><i/><i/></div><p className="eyebrow">PLANT FOR THE YEAR AHEAD</p><h1>种下一份年度视角<br/>慢慢走好每一个阶段</h1><div className="life-order"><small>本次交付</small><h2>2026 年运 · 年度地图</h2><p>档案 V1 · 七章节完整报告</p><div><span>包含内容</span><strong>四季＋十二月＋四大维度</strong></div><div><span>智慧种子</span><strong className="seed-cost">20 ●</strong></div></div><div className="balance-change"><span>当前余额 <b>28</b></span><i>→</i><span>完成后 <b>8</b></span></div><div className="seed-protection"><span>护</span><p><strong>年运不自动包含十二份完整月运</strong>报告任务失败且无有效交付时，智慧种子会自动退回。</p></div><button className="primary" onClick={onNext}>确认并种下 20 颗智慧种子 <span>→</span></button></section>}

function AnnualGenerating({onBack,onNext,onLeave}:{onBack:()=>void;onNext:()=>void;onLeave:()=>void}){return <section className="growth-page annual-generating"><GrowthHeader title="正在生成年度地图" onBack={onBack}/><div className="year-grow"><span>2026</span><i/><i/><i/><i/></div><p className="eyebrow">MAPPING YOUR YEAR</p><h1>正在把一整年的节奏<br/>整理成可以行走的地图</h1><div className="life-progress"><span className="done">✓ 确认目标年度与档案版本</span><span className="done">✓ 分别读取外部、关系与事业线</span><span className="active">· 组织四季节奏与十二个月索引</span><span>· 整理四大维度与年度行动</span></div><p className="generate-away">年运是长任务，可以离开；完成后会通过消息中心提醒你。</p><button className="text-action" onClick={onNext}>原型中直接查看年运摘要 →</button><button className="outline-button" onClick={onLeave}>先离开，完成后提醒我</button></section>}

function AnnualSummary({onBack,onMap,onFull,onDimensions,onReview}:{onBack:()=>void;onMap:()=>void;onFull:()=>void;onDimensions:()=>void;onReview:()=>void}){return <section className="growth-page annual-page annual-summary"><GrowthHeader title="2026 年度地图" onBack={onBack}/><div className="annual-summary-cover"><small>YOUR YEAR IN SEASONS</small><span>2026</span><h1>在变化里建立秩序<br/>让真正重要的事持续生长</h1><p>小满的年度地图 · 档案 V1</p></div><div className="year-phases"><small>全年三个主要阶段</small><div><span><b>一</b>辨认方向</span><i>→</i><span><b>二</b>稳定推进</span><i>→</i><span><b>三</b>整理收获</span></div></div><div className="year-focus">{[["业","事业","减少分散，把资源留给关键推进"],["情","关系","在表达需要与尊重边界之间平衡"],["心","身心","把恢复视作长期行动的一部分"]].map(x=><p key={x[1]}><i>{x[0]}</i><span><strong>{x[1]}</strong><small>{x[2]}</small></span></p>)}</div><div className="annual-nav-cards"><button onClick={onMap}><span>图</span><p><strong>打开年度地图</strong><small>四季与十二个月索引</small></p><b>›</b></button><button onClick={onDimensions}><span>维</span><p><strong>查看四大维度</strong><small>事业、关系、财务与身心</small></p><b>›</b></button></div><button className="primary" onClick={onFull}>阅读完整年运报告 <span>→</span></button><button className="text-action" onClick={onReview}>原型分支 · 查看年末回顾</button></section>}

function AnnualMap({onBack,onMonth}:{onBack:()=>void;onMonth:()=>void}){const months=["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"];const [season,setSeason]=useState("全年");return <section className="growth-page annual-page annual-map"><GrowthHeader title="2026 年度地图" onBack={onBack}/><div className="map-year"><span>2026</span><p>不标吉凶，只标记每个阶段值得关注的方向</p></div><div className="season-tabs">{["全年","春","夏","秋","冬"].map(x=><button className={season===x?"active":""} onClick={()=>setSeason(x)} key={x}>{x}</button>)}</div><div className="month-map">{months.map((x,i)=><button onClick={onMonth} key={x} className={i===7?"current":""}><span><small>{x}</small><strong>{["启程","连接","辨认","展开","推进","调整","沉淀","聚焦","协作","收拢","复盘","归整"][i]}</strong></span><div><i className="external"/><i className="relation"/><i className="career"/></div><b>{i===7?"已有月运":"›"}</b></button>)}</div><div className="map-legend"><span><i className="external"/>外部节奏</span><span><i className="relation"/>关系与内在</span><span><i className="career"/>事业与做事</span></div></section>}

function AnnualFullReport({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){const parts=["年度定调","全年大势总览","四季节奏","十二个月索引","四大维度总结","年度行动规划","写给这一年的话"];const [open,setOpen]=useState(0);return <section className="growth-page annual-page annual-report"><GrowthHeader title="完整年运报告" onBack={onBack}/><div className="annual-report-title"><span>年</span><small>2026 年度地图</small><h1>在变化里建立秩序<br/>让重要的事持续生长</h1></div><div className="month-report-sections">{parts.map((x,i)=><article key={x}><button onClick={()=>setOpen(i)}><strong>0{i+1} · {x}</strong><b>{open===i?"−":"+"}</b></button>{open===i&&<div><p>{i===0?"这一年更适合从辨认重点开始，把分散的力量重新带回真正重要的方向。":i===3?"十二个月只提供年度层面的索引；每个月的正式月运需要在当月重新生成。":"这一章节帮助你从全年视角理解阶段、关系与现实行动，不把趋势写成确定事件。"}</p><blockquote>年度地图是观察框架，真正的人生仍由你的选择与行动共同形成。</blockquote></div>}</article>)}</div><button className="primary" onClick={onNext}>选择年度关注方向 <span>→</span></button></section>}

function AnnualDimensions({onBack}:{onBack:()=>void}){const [open,setOpen]=useState("");const dims=[["业","事业","推进、协作、学习与复盘","把长期资源集中在真正重要的工作上"],["情","关系","表达、连接与边界","先理解自己的需要，再进入重要对话"],["财","财务","预算、现金流与风险意识","使用真实数据评估重大财务决定"],["心","身心","恢复、压力与生活节奏","不把休息放在所有事情完成之后"]];return <section className="growth-page annual-page dimensions"><GrowthHeader title="年度四大维度" onBack={onBack}/><p className="eyebrow">FOUR WAYS TO VIEW THE YEAR</p><h1>同一年，也可以从<br/>不同生活方向去理解</h1><div className="dimension-list">{dims.map(x=><article className={open===x[1]?"open":""} key={x[1]}><i>{x[0]}</i><span><small>{x[2]}</small><strong>{x[1]}</strong><p>{x[3]}</p>{open===x[1]&&<em className="dimension-detail">建议：选择一项可验证的小行动，并在季度回顾中记录真实变化。</em>}</span><button onClick={()=>setOpen(v=>v===x[1]?"":x[1])}>{open===x[1]?"收起":"查看 ›"}</button></article>)}</div><div className="annual-boundary"><span>界</span><p><strong>不预测具体结果</strong>不承诺升职、收益或关系事件，也不提供医疗诊断与投资指令。</p></div></section>}

function AnnualMonthDetail({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){return <section className="growth-page annual-page year-month"><GrowthHeader title="年度地图 · 八月" onBack={onBack}/><div className="year-month-cover"><small>在全年地图中的位置</small><span>八月</span><h1>从调整走向聚焦</h1><p>年度索引 · 不是正式月运</p></div><div className="three-lines">{[["外","外部节奏","变化开始收拢，适合辨认长期价值"],["情","关系与内在","表达需要之前，先整理真实感受"],["业","事业与做事","从分散回应转向一个关键推进"]].map(x=><p key={x[1]}><i>{x[0]}</i><span><strong>{x[1]}</strong><small>{x[2]}</small></span></p>)}</div><div className="index-action"><small>年度层面的一项关注</small><p>减少同时推进的事情，为一个真正重要的方向保留完整时间。</p></div><button className="primary" onClick={onNext}>查看年度索引与正式月运的区别 <span>→</span></button></section>}

function AnnualToMonthly({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){return <section className="growth-page annual-page annual-to-month"><GrowthHeader title="进入正式月运" onBack={onBack}/><p className="eyebrow">TWO VIEWS · ONE MONTH</p><h1>年度索引告诉你位置<br/>正式月运告诉你当下</h1><div className="compare-reports"><article><span>年</span><small>年运中的八月</small><strong>全年地图索引</strong><p>生成于年初<br/>看八月在全年中的位置<br/>三条分析线的轻量摘要</p></article><i>≠</i><article><span>月</span><small>正式八月月运</small><strong>当月完整分析</strong><p>进入本月后生成<br/>包含前后半月与五大领域<br/>提供具体行动与月末回顾</p></article></div><div className="annual-boundary"><span>释</span><p><strong>两者不同并不代表谁失准</strong>计算粒度、生成时间、档案或知识版本都可能不同。</p></div><button className="primary" onClick={onNext}>进入八月正式月运 <span>→</span></button><button className="text-action" onClick={onBack}>只看年度索引</button></section>}

function AnnualActions({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){const choices=["集中资源完成一个长期项目","建立更稳定的恢复与休息节奏","练习在重要关系里表达真实需要","每季度整理一次预算与资源安排"];const [picked,setPicked]=useState([choices[0]]);const toggle=(x:string)=>setPicked(p=>p.includes(x)?p.filter(v=>v!==x):p.length<3?[...p,x]:p);return <section className="growth-page annual-page annual-actions"><GrowthHeader title="年度行动规划" onBack={onBack}/><p className="eyebrow">THREE DIRECTIONS ARE ENOUGH</p><h1>这一年，不需要安排<br/>十二个月的任务清单</h1><p className="growth-lead">最多选择三个年度关注方向，每个方向只带走一个最小行动。</p><div className="action-counter"><span>年度关注</span><strong>{picked.length} / 3</strong></div><div className="month-action-list">{choices.map(x=><button className={picked.includes(x)?"active":""} onClick={()=>toggle(x)} key={x}><i>{picked.includes(x)?"✓":""}</i><span>{x}</span></button>)}</div><div className="quarter-review"><span>季</span><p><strong>建议按季度回顾</strong>正式月运生成后，可以根据当月真实情况调整行动。</p></div><button className="primary" onClick={onNext}>保存方向，设置年中回顾 <span>→</span></button></section>}

function AnnualReview({kind,onBack,onHome}:{kind:string;onBack:()=>void;onHome:()=>void}){const [state,setState]=useState("更清楚了");return <section className="growth-page annual-page annual-review"><GrowthHeader title={`${kind}回顾`} onBack={onBack}/><div className="review-year"><span>2026</span><small>{kind === "年中"?"JAN—JUN":"JAN—DEC"}</small></div><p className="eyebrow">LOOK BACK AT REAL LIFE</p><h1>{kind==="年中"?"不是检查上半年命中了什么":"这一年，不用用完成率评价自己"}</h1><p className="growth-lead">回看真实经历、行动与变化，再决定下一阶段想继续关注什么。</p><div className="review-stats"><span><small>重要记录</small><strong>{kind==="年中"?6:14}</strong></span><span><small>完成行动</small><strong>{kind==="年中"?2:5}</strong></span><span><small>调整方向</small><strong>1</strong></span></div><div className="review-feeling"><strong>回看这一阶段，你更接近哪种感受？</strong><div>{["更清楚了","发生了变化","仍在路上","想重新选择"].map(x=><button className={state===x?"active":""} onClick={()=>setState(x)} key={x}>{x}</button>)}</div><textarea placeholder="写下一件对你真正重要的事…"/></div><label className="timeline-switch"><span><strong>保存到成长时间线</strong><small>只保存你确认的内容</small></span><input type="checkbox" defaultChecked/></label><button className="primary" onClick={onHome}>完成{kind}回顾 <span>→</span></button></section>}

function GrowthTasks({onBack,onOpen}:{onBack:()=>void;onOpen:()=>void}){return <section className="growth-page revisit-page"><GrowthHeader title="生成任务中心" onBack={onBack}/><div className="task-overview"><span><small>进行中</small><strong>1</strong></span><p>报告可以在后台慢慢生长<br/><b>离开页面也不会丢失</b></p></div><div className="task-tabs"><button className="active">全部</button><button>生成中</button><button>已完成</button><button>需处理</button></div><div className="task-list"><button onClick={onOpen}><i className="growing">月</i><span><small>正在生成 · 约 2 分钟</small><strong>八月整体月运</strong><p>正在整理五大领域与综合行动</p></span><b>68%</b></button><button onClick={onOpen}><i>年</i><span><small>今天完成</small><strong>2026 年度地图</strong><p>报告已保存到成长报告库</p></span><b>查看 ›</b></button><button><i className="failed">问</i><span><small>生成暂停</small><strong>工作变化问事</strong><p>原问题与卡牌已保存，可继续生成</p></span><b>重试 ›</b></button></div><div className="task-rule">生成失败不会重复扣除智慧种子；超过处理时间会按规则自动退回。</div></section>}

function GrowthTimeline({onBack,onFilter,onEvent,onRecord,onManage,onActions,onReview}:{onBack:()=>void;onFilter:()=>void;onEvent:()=>void;onRecord:()=>void;onManage:()=>void;onActions:()=>void;onReview:()=>void}){const events=[["今天","月","完成八月整体月运","看见本月重点与行动"],["昨天","行","完成一次现实行动","为自己留出不被打扰的恢复时间"],["08月05日","问","工作变化问事","变化邀请我重新选择"],["08月01日","光","生成生命之光","开始理解自己的长期生命底图"]];return <section className="growth-page revisit-page timeline-page"><GrowthHeader title="成长时间线" onBack={onBack}/><div className="timeline-head"><span>这一阶段</span><h1>从看见自己<br/>到真实发生改变</h1><p>这里只保留对理解成长有意义的内容</p></div><div className="timeline-actions"><button onClick={onRecord}>＋ 写一条记录</button><button onClick={onActions}>我的行动</button><button onClick={onReview}>阶段回顾</button></div><div className="timeline-toolbar"><strong>最近发生</strong><button onClick={onFilter}>筛选⌄</button></div><div className="timeline-events">{events.map(x=><button onClick={onEvent} key={x[2]}><time>{x[0]}</time><i>{x[1]}</i><span><strong>{x[2]}</strong><small>{x[3]}</small></span><b>›</b></button>)}</div><button className="manage-timeline" onClick={onManage}>管理时间线显示与隐私</button></section>}

function TimelineFilter({onBack}:{onBack:()=>void}){const [types,setTypes]=useState(["洞察","行动","现实反馈"]);const toggle=(x:string)=>setTypes(p=>p.includes(x)?p.filter(v=>v!==x):[...p,x]);return <section className="growth-page revisit-page"><GrowthHeader title="筛选时间线" onBack={onBack}/><p className="eyebrow">SHOW WHAT MATTERS</p><h1>选择这次想回看的<br/>成长内容</h1><div className="filter-group"><strong>事件类型</strong>{["洞察","行动","现实反馈","报告","关系与阶段事件"].map(x=><button className={types.includes(x)?"active":""} onClick={()=>toggle(x)} key={x}><i>{types.includes(x)?"✓":""}</i>{x}</button>)}</div><div className="filter-group"><strong>时间范围</strong>{["最近30天","最近3个月","今年","全部时间"].map((x,i)=><button className={i===1?"active":""} key={x}><i>{i===1?"✓":""}</i>{x}</button>)}</div><button className="primary" onClick={onBack}>应用筛选 <span>→</span></button></section>}

function GrowthEventDetail({onBack}:{onBack:()=>void}){return <section className="growth-page revisit-page event-detail"><GrowthHeader title="成长事件" onBack={onBack}/><div className="event-symbol"><span>行</span><i/><i/></div><p className="eyebrow">A REAL STEP</p><h1>为自己留出一段<br/>不被打扰的恢复时间</h1><div className="event-card"><small>昨天 · 行动结果</small><p>我原本以为停下来会耽误进度，但真正休息以后，反而更清楚下一步该做什么。</p><div><span>感受</span><strong>更平静，也更清楚</strong></div><div><span>结果</span><strong>完成并愿意继续</strong></div></div><div className="event-source"><span>来源</span><strong>八月整体月运 · 本月行动</strong><button>打开来源报告</button></div><button className="outline-button">编辑这条现实反馈</button><button className="text-action">从时间线隐藏</button></section>}

function GrowthRecord({onBack,onSave}:{onBack:()=>void;onSave:()=>void}){const [mood,setMood]=useState("有新的理解");return <section className="growth-page revisit-page"><GrowthHeader title="记录此刻" onBack={onBack}/><p className="eyebrow">WRITE WHAT IS REAL</p><h1>这里不需要写得完整<br/>只记录此刻真实的你</h1><div className="record-type"><small>这更接近</small><div>{["发生了一件事","有新的理解","感受发生变化"].map(x=><button className={mood===x?"active":""} onClick={()=>setMood(x)} key={x}>{x}</button>)}</div></div><textarea className="record-text" defaultValue="今天我发现，当我不急着回应所有事情时，真正重要的方向反而更清楚了。"/><div className="record-links"><strong>关联内容（可选）</strong><button>＋ 关联一份报告或行动</button></div><label className="timeline-switch"><span><strong>保存到成长时间线</strong><small>默认仅自己可见，可随时修改或隐藏</small></span><input type="checkbox" defaultChecked/></label><button className="primary" onClick={onSave}>保存这条记录 <span>→</span></button></section>}

function TimelineManage({onBack}:{onBack:()=>void}){return <section className="growth-page revisit-page"><GrowthHeader title="时间线显示管理" onBack={onBack}/><p className="eyebrow">YOU CONTROL THE STORY</p><h1>哪些内容出现<br/>由你自己决定</h1><div className="manage-list">{[["月运与年运","显示重要周期报告",true],["问事洞察","显示已完成的问事",true],["个人行动","显示采纳与结果",true],["关系报告","仅在权限有效时显示",false],["每日指引","按月聚合，不逐日刷屏",true]].map(x=><label key={String(x[0])}><span><strong>{x[0]}</strong><small>{x[1]}</small></span><input type="checkbox" defaultChecked={Boolean(x[2])}/></label>)}</div><div className="task-rule">隐藏不会删除源报告；删除报告时会再次说明对时间线与 AI 上下文的影响。</div><button className="primary" onClick={onBack}>保存显示设置 <span>→</span></button></section>}

function GrowthActions({onBack,onAdopt,onDetail}:{onBack:()=>void;onAdopt:()=>void;onDetail:()=>void}){return <section className="growth-page revisit-page"><GrowthHeader title="我的行动" onBack={onBack}/><div className="action-overview"><span><small>进行中</small><strong>2</strong></span><span><small>本月完成</small><strong>3</strong></span><span><small>等待反馈</small><strong>1</strong></span></div><div className="task-tabs"><button className="active">进行中</button><button>待开始</button><button>已完成</button><button>已归档</button></div><div className="growth-action-cards"><button onClick={onDetail}><small>来自 · 八月整体月运</small><strong>每天只保留一个最重要任务</strong><p>每周回看 · 已坚持 5 天</p><span>进行中 ›</span></button><button onClick={onDetail}><small>来自 · 生命之光</small><strong>为重要选择留出三天观察期</strong><p>计划本周开始</p><span>待开始 ›</span></button></div><button className="outline-button" onClick={onAdopt}>＋ 从报告建议创建行动</button></section>}

function AdoptAction({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){const [pick,setPick]=useState("每周安排两次不被打扰的恢复时间");return <section className="growth-page revisit-page"><GrowthHeader title="采纳一个行动" onBack={onBack}/><p className="eyebrow">FROM INSIGHT TO ACTION</p><h1>从报告里带走一件<br/>此刻愿意尝试的事</h1><div className="source-chip"><span>月</span><p><small>来自八月整体月运</small><strong>先恢复清晰，再推动外部变化</strong></p></div><div className="month-action-list">{["每周安排两次不被打扰的恢复时间","每天只保留一个最重要任务","重要沟通前先写下真实需要"].map(x=><button className={pick===x?"active":""} onClick={()=>setPick(x)} key={x}><i>{pick===x?"✓":""}</i><span>{x}</span></button>)}</div><div className="task-rule">你可以改写建议。行动属于你，不会因为报告更新而自动改变。</div><button className="primary" onClick={onNext}>选择这个行动 <span>→</span></button></section>}

function EditAction({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){return <section className="growth-page revisit-page"><GrowthHeader title="完善行动计划" onBack={onBack}/><p className="eyebrow">MAKE IT SMALL ENOUGH</p><h1>让行动小到<br/>今天就能开始</h1><label className="edit-field"><span>行动内容</span><textarea defaultValue="每周安排两次不被打扰的恢复时间"/></label><label className="edit-field"><span>计划开始</span><input defaultValue="今天"/></label><label className="edit-field"><span>回看频率</span><input defaultValue="每周一次"/></label><label className="timeline-switch"><span><strong>温和提醒</strong><small>只提醒回看，不连续催促</small></span><input type="checkbox" defaultChecked/></label><button className="primary" onClick={onNext}>保存行动计划 <span>→</span></button></section>}

function ActionDetail({onBack,onResult}:{onBack:()=>void;onResult:()=>void}){return <section className="growth-page revisit-page action-detail"><GrowthHeader title="行动详情" onBack={onBack}/><div className="action-detail-head"><span>行</span><small>进行中 · 第 5 天</small><h1>每天只保留一个<br/>最重要任务</h1><p>来自 · 八月整体月运</p></div><div className="action-progress"><span><small>本周完成</small><strong>4 / 5</strong></span><i><b/></i><p>你已经留下 4 次真实记录</p></div><div className="action-history"><strong>最近记录</strong><p><time>今天</time><span>完成后感觉更专注，也更有余地。</span></p><p><time>昨天</time><span>没有完成，临时事情打乱了安排。</span></p></div><button className="primary" onClick={onResult}>记录今天的结果 <span>→</span></button><button className="outline-button">编辑或暂停行动</button></section>}

function ActionResult({onBack,onSave}:{onBack:()=>void;onSave:()=>void}){const [result,setResult]=useState("完成了");return <section className="growth-page revisit-page"><GrowthHeader title="记录行动结果" onBack={onBack}/><p className="eyebrow">WHAT HAPPENED TODAY</p><h1>结果没有好坏<br/>真实就是最有用的反馈</h1><div className="result-choice">{["完成了","做了一部分","今天没做","决定放弃"].map(x=><button className={result===x?"active":""} onClick={()=>setResult(x)} key={x}>{x}</button>)}</div><textarea className="record-text" placeholder="做完以后，你有什么真实感受或新的发现？"/><div className="result-feelings"><small>此刻更接近</small><div>{["更轻松","更清楚","有些困难","还需要时间"].map(x=><button key={x}>{x}</button>)}</div></div><label className="timeline-switch"><span><strong>作为现实反馈进入时间线</strong><small>你可以随时隐藏或删除</small></span><input type="checkbox" defaultChecked/></label><button className="primary" onClick={onSave}>保存真实结果 <span>→</span></button></section>}

function StageReviewStart({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){return <section className="growth-page revisit-page review-start"><GrowthHeader title="阶段回顾" onBack={onBack}/><div className="review-season"><span>回</span><i/><i/></div><p className="eyebrow">A CHAPTER, NOT A SCORE</p><h1>回看这一段路<br/>理解什么正在发生变化</h1><p className="growth-lead">阶段回顾不会判断报告命中了多少，而是整理你选择的洞察、行动和真实经历。</p><div className="review-range"><strong>这次想回看</strong>{["最近30天","最近3个月","2026年至今","自定义范围"].map((x,i)=><button className={i===1?"active":""} key={x}><i>{i===1?"✓":""}</i>{x}</button>)}</div><button className="primary" onClick={onNext}>选择回顾素材 <span>→</span></button></section>}

function ReviewMaterials({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){const [selected,setSelected]=useState([0,1,2]);const items=[["月","八月整体月运","本月重点与行动"],["问","工作变化问事","一次重新选择的洞察"],["行","重要任务行动","5 次行动与结果"],["记","个人记录","2 条真实感受"]];return <section className="growth-page revisit-page"><GrowthHeader title="选择回顾素材" onBack={onBack}/><p className="eyebrow">YOU CHOOSE THE CONTEXT</p><h1>只整理你愿意<br/>带进这次回顾的内容</h1><div className="material-list">{items.map((x,i)=><button className={selected.includes(i)?"active":""} onClick={()=>setSelected(p=>p.includes(i)?p.filter(v=>v!==i):[...p,i])} key={x[1]}><i>{x[0]}</i><span><strong>{x[1]}</strong><small>{x[2]}</small></span><b>{selected.includes(i)?"✓":""}</b></button>)}</div><div className="task-rule">未选择的报告、关系内容和私人记录不会参与本次整理。</div><button className="primary" onClick={onNext}>整理 {selected.length} 项素材 <span>→</span></button></section>}

function ReviewCandidate({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){return <section className="growth-page revisit-page"><GrowthHeader title="候选阶段主题" onBack={onBack}/><p className="eyebrow">A POSSIBLE THREAD</p><h1>我们从你选择的内容里<br/>整理出一条可能的线索</h1><div className="candidate-theme"><small>候选主题</small><h2>从同时回应所有事情<br/>到把力量留给真正重要的方向</h2><p>过去三个月里，你多次提到分散、疲惫与重新选择；同时，你已经开始通过更小的行动保护自己的节奏。</p></div><div className="evidence-list"><strong>它来自这些真实内容</strong><span><b>月</b>八月月运中的“减少分散”</span><span><b>问</b>工作变化问事中的“重新选择”</span><span><b>行</b>5 次重要任务行动记录</span></div><div className="annual-boundary"><span>候</span><p><strong>这只是候选，不会自动成为结论</strong>下一步由你修改、补充或完全不用它。</p></div><button className="primary" onClick={onNext}>这个方向有感觉，继续 <span>→</span></button><button className="text-action">换一个整理角度</button></section>}

function ReviewConfirm({onBack,onNext}:{onBack:()=>void;onNext:()=>void}){return <section className="growth-page revisit-page"><GrowthHeader title="确认自己的总结" onBack={onBack}/><p className="eyebrow">MAKE IT YOUR OWN</p><h1>最后的理解<br/>应该由你亲自确认</h1><label className="edit-field"><span>这一阶段的主题</span><textarea defaultValue="把力量留给真正重要的方向"/></label><label className="edit-field"><span>我真正经历了什么</span><textarea defaultValue="我开始减少同时推进的事情，也第一次发现，停下来整理并不意味着退后。"/></label><label className="edit-field"><span>下一阶段想关注</span><textarea defaultValue="继续保护自己的节奏，同时把一个重要方向稳定推进下去。"/></label><label className="timeline-switch"><span><strong>保存为正式阶段回顾</strong><small>确认后进入报告库与成长时间线</small></span><input type="checkbox" defaultChecked/></label><button className="primary" onClick={onNext}>确认并生成阶段回顾 <span>→</span></button></section>}

function StageReviewReport({onBack,onHome}:{onBack:()=>void;onHome:()=>void}){return <section className="growth-page revisit-page stage-report"><GrowthHeader title="阶段回顾报告" onBack={onBack}/><div className="stage-cover"><small>MY GROWTH CHAPTER</small><span>回</span><h1>把力量留给<br/>真正重要的方向</h1><p>2026.05.07—08.07</p></div><article><small>这一阶段，我经历了什么</small><p>我开始减少同时推进的事情，也第一次发现，停下来整理并不意味着退后。</p></article><article><small>已经发生的真实变化</small><p>我完成了几次小行动，并在没有完成时也愿意如实记录，而不是用结果否定自己。</p></article><article><small>下一阶段想继续关注</small><p>继续保护自己的节奏，同时把一个重要方向稳定推进下去。</p></article><div className="feedback-summary"><span>阶段回顾 <b>已保存</b></span><span>成长时间线 <b>已更新</b></span><span>下一阶段关注 <b>1 项</b></span></div><button className="primary" onClick={onHome}>完成，回到成长首页 <span>→</span></button></section>}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a className={`brand ${compact ? "brand-compact" : ""}`} href="#" aria-label="身心游首页">
      <span className="brand-mark" aria-hidden="true"><i /></span>
      {!compact && <span><strong>身心游</strong><small>SATORI</small></span>}
    </a>
  );
}
