"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type Bootstrap } from "@/src/api/client";
import { useSession } from "@/src/shared/session";
import { RouteFrame } from "@/src/shared/shell";
import { authenticatedEntryPath, ROUTES } from "@/src/shared/routes";
import { PROTOTYPE_MODE } from "@/src/shared/prototype";
import { apiMessage, Brand, legalHref, LiveMessage, PageDebugLabel, requiredConsentAcceptances } from "@/src/shared/ui";

function authMessage(error: unknown) {
  if (error instanceof ApiError && error.code === "SMS_RATE_LIMITED") return "请求过于频繁，请稍后再试";
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "请求超时，请检查网络后重试";
  }
  return apiMessage(error);
}

export default function LoginScreen() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [message, setMessage] = useState("");
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [challengeId, setChallengeId] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const sendingLock = useRef(false);
  const { status, me, markAuthenticated } = useSession();
  const router = useRouter();
  const normalizedPhone = phone.replace(/\D/g, "").slice(0, 11);
  const phoneReady = /^1\d{10}$/.test(normalizedPhone);
  const codeReady = /^\d{6}$/.test(code);

  useEffect(() => { void api.bootstrap().then(setBootstrap).catch(() => undefined); }, []);
  useEffect(() => {
    if (status === "authenticated" && me) router.replace(authenticatedEntryPath(me.nextAction));
  }, [me, router, status]);
  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => setResendSeconds((current) => Math.max(0, current - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  async function loadAcceptances() {
    const current = await api.bootstrap();
    setBootstrap(current);
    return requiredConsentAcceptances(current);
  }

  async function sendCode() {
    if (sendingLock.current || submitting || resendSeconds > 0) return;
    if (!phoneReady) return setMessage("请输入正确的 11 位手机号码");
    if (!agreed) return setMessage("请先阅读并同意用户协议与隐私政策");
    sendingLock.current = true;
    setSendingCode(true);
    setMessage("");
    try {
      const challenge = await api.sendSms(normalizedPhone);
      setChallengeId(challenge.challengeId);
      setCodeSent(true);
      setResendSeconds(Math.max(1, Math.ceil((Date.parse(challenge.resendAvailableAt) - Date.now()) / 1_000)));
      setMessage(`验证码已发送至 ${challenge.phoneMasked}`);
    } catch (error) {
      setMessage(authMessage(error));
    } finally {
      sendingLock.current = false;
      setSendingCode(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting || sendingLock.current) return;
    if (PROTOTYPE_MODE) {
      setMessage("原型验证登录成功");
      router.replace(ROUTES.profileCreate);
      return;
    }
    if (!phoneReady || !agreed) return void sendCode();
    if (!codeReady) return setMessage("请输入 6 位验证码");
    if (!challengeId) return void sendCode();
    setSubmitting(true);
    setMessage("");
    try {
      let acceptances = await loadAcceptances();
      let session;
      try {
        session = await api.createSession(challengeId, code, acceptances);
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "LEGAL_DOCUMENT_VERSION_INVALID") throw error;
        acceptances = await loadAcceptances();
        session = await api.createSession(challengeId, code, acceptances);
      }
      if ((session.user.requiresConsent || session.nextAction === "ACCEPT_CONSENTS") && acceptances.length > 0) {
        await api.acceptConsents(acceptances);
      }
      const current = await api.me();
      markAuthenticated(current);
      setMessage("登录成功");
      router.replace(authenticatedEntryPath(current.nextAction));
    } catch (error) {
      setMessage(authMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  const sendLabel = PROTOTYPE_MODE
    ? "原型免验证"
    : sendingCode
      ? "发送中"
      : resendSeconds > 0
        ? `${resendSeconds} 秒后重发`
        : codeSent
          ? "重新发送"
          : "获取验证码";

  return <RouteFrame title="登录" label="手机号登录与注册" mode="login-mode">
    <div className="login-page">
      <PageDebugLabel>{`R1.0 · ${codeSent ? "AUTH-04" : "AUTH-03"}`}</PageDebugLabel>
      <header className="brand-row login-header"><Brand /></header>
      <div className="login-symbol" aria-hidden="true"><i /><span>归</span></div>
      <div className="login-copy"><p className="eyebrow">WELCOME BACK</p><h1>欢迎回来</h1><p>一个手机号，对应一份属于你的生命智慧档案。未注册的手机号验证后将自动创建账号。</p></div>
      <form className="login-form" id="AUTH-03-04" onSubmit={submit} noValidate>
        <label className="field-label" htmlFor="phone">手机号</label>
        <div className={`field ${message.includes("手机号码") ? "field-error" : ""}`}>
          <span className="country-code">+86</span><span className="field-divider" />
          <input id="phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="请输入手机号码" value={normalizedPhone} disabled={sendingCode || submitting} onChange={(event) => {
            setPhone(event.target.value);
            setCode("");
            setChallengeId("");
            setCodeSent(false);
            setResendSeconds(0);
            setMessage("");
          }} />
        </div>
        <div className="code-title-row"><label className="field-label" htmlFor="code">验证码</label>{codeSent && <span className="sent-hint">已发送至 {normalizedPhone.slice(0, 3)}****{normalizedPhone.slice(-4)}</span>}</div>
        <div className="field code-field">
          <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6 位验证码" maxLength={6} value={code} onChange={(event) => { setCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setMessage(""); }} />
          <button type="button" className="send-code" onClick={() => void sendCode()} disabled={sendingCode || submitting || resendSeconds > 0 || PROTOTYPE_MODE}>{sendLabel}</button>
        </div>
        <label className="consent-row"><input type="checkbox" checked={agreed} onChange={(event) => { setAgreed(event.target.checked); setMessage(""); }} /><span className="checkmark" aria-hidden="true">✓</span><span>我已阅读并同意 <a href={legalHref(bootstrap, "TERMS_OF_SERVICE")} target="_blank">用户协议</a>、<a href={legalHref(bootstrap, "PRIVACY_POLICY")} target="_blank">隐私政策</a>，并知晓相关资料的用途</span></label>
        <LiveMessage success={message.startsWith("登录成功")}>{message || (PROTOTYPE_MODE ? "当前为本地原型验证，可直接点击登录 / 注册" : "验证码仅用于身份验证，我们不会用它向你营销")}</LiveMessage>
        <button className="primary login-submit" type="submit" disabled={!PROTOTYPE_MODE && (!phoneReady || !codeReady || !agreed || sendingCode || submitting)}>{submitting ? "登录中…" : "登录 / 注册"} <span>→</span></button>
      </form>
      <div className="login-footer"><span className="lock" aria-hidden="true" />账号与生命智慧档案会安全绑定，不会公开展示手机号</div>
    </div>
  </RouteFrame>;
}
