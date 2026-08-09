"use client";

import { useEffect, useState } from "react";

type Screen = "WELCOME" | "LOGIN" | "CODE" | "ROUTING";

const releaseLabel: Record<Screen, string> = {
  WELCOME: "R1.0 · AUTH-01",
  LOGIN: "R1.0 · AUTH-02",
  CODE: "R1.0 · AUTH-03",
  ROUTING: "R1.0 · AUTH-04",
};

export default function Home() {
  const [screen, setScreen] = useState<Screen>("WELCOME");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const validPhone = /^1\d{10}$/.test(phone);

  useEffect(() => {
    if (!seconds) return;
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);

  function requestCode() {
    if (!validPhone || !accepted) return;
    setSeconds(60);
    setScreen("CODE");
  }

  return (
    <main className="stage">
      <section className="phone-shell">
        <header className="release-header">
          {screen !== "WELCOME" && <button aria-label="返回" onClick={() => setScreen(screen === "CODE" ? "LOGIN" : "WELCOME")}>‹</button>}
          <span>{releaseLabel[screen]}</span>
        </header>

        {screen === "WELCOME" && (
          <div className="welcome screen-enter">
            <div className="life-mark"><i/><i/><span>悟</span></div>
            <p className="eyebrow">SATORI · GROW WITHIN</p>
            <h1>看见自己<br/>也看见生命正在生长</h1>
            <p className="lead">从一份生命智慧档案出发，在每一天里获得温柔、清晰且可以行动的陪伴。</p>
            <button className="primary" onClick={() => setScreen("LOGIN")}>开始了解自己 <b>→</b></button>
          </div>
        )}

        {screen === "LOGIN" && (
          <div className="auth screen-enter">
            <div className="seed-symbol">种</div>
            <p className="eyebrow">WELCOME TO SATORI</p>
            <h1>手机号登录或注册</h1>
            <p className="lead">未注册的手机号验证成功后，将自动创建账号。</p>
            <label><span>手机号</span><div className="phone-input"><b>+86</b><input inputMode="numeric" maxLength={11} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} placeholder="请输入手机号"/></div></label>
            <label className="consent"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)}/><span>我已阅读并同意 <button>用户协议</button>、<button>隐私政策</button>和<button>AI 内容说明</button></span></label>
            <button className="primary" disabled={!validPhone || !accepted} onClick={requestCode}>获取验证码 <b>→</b></button>
            <p className="safe-note">手机号仅用于身份验证，我们不会公开你的个人信息。</p>
          </div>
        )}

        {screen === "CODE" && (
          <div className="auth screen-enter">
            <div className="seed-symbol small">验</div>
            <p className="eyebrow">VERIFY YOUR PHONE</p>
            <h1>输入短信验证码</h1>
            <p className="lead">验证码已发送至 +86 {phone.slice(0,3)}****{phone.slice(-4)}</p>
            <label><span>6 位验证码</span><input className="code-input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="· · · · · ·"/></label>
            <button className="primary" disabled={code.length !== 6} onClick={() => setScreen("ROUTING")}>验证并继续 <b>→</b></button>
            <button className="resend" disabled={seconds > 0} onClick={() => setSeconds(60)}>{seconds > 0 ? `${seconds} 秒后可重新发送` : "重新发送验证码"}</button>
          </div>
        )}

        {screen === "ROUTING" && (
          <div className="routing screen-enter">
            <div className="route-orbit"><span>生</span><i/><i/></div>
            <p className="eyebrow">PREPARING YOUR PATH</p>
            <h1>登录成功<br/>正在确认你的下一步</h1>
            <div className="route-list"><span className="done">✓ 登录状态已确认</span><span className="active">· 正在读取生命智慧档案状态</span><span>· 即将进入正确页面</span></div>
            <button className="primary" onClick={() => setScreen("WELCOME")}>预览完成，返回首页 <b>→</b></button>
            <p className="mock-note">当前使用 Mock 登录流程；真实接口将接入后端 `/auth/sessions*`。</p>
          </div>
        )}
      </section>
    </main>
  );
}
