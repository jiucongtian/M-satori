"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/src/shared/session";
import { Brand, PageDebugLabel } from "@/src/shared/ui";
import { RouteFrame } from "@/src/shared/shell";
import { authenticatedEntryPath, ROUTES } from "@/src/shared/routes";

export default function WelcomeScreen() {
  const [started, setStarted] = useState(false); const { status, me } = useSession(); const router = useRouter();
  useEffect(() => { if (status === "authenticated" && me) router.replace(authenticatedEntryPath(me.nextAction)); }, [me, router, status]);
  return <RouteFrame title="每一天，重新看见自己" label="初见欢迎页" mode=""><PageDebugLabel>R1.0 · AUTH-02</PageDebugLabel><header className="brand-row"><Brand /></header><div className="hero-copy"><p className="eyebrow">YOUR INNER SEASONS</p><h1>每一天，<br /><em>更懂自己一点</em></h1><p className="intro">从你的出生时刻出发，读懂当下的节律，找到适合自己的下一步。</p></div><div className="life-orbit" aria-hidden="true"><div className="orbit orbit-outer"><b /><b /><b /></div><div className="orbit orbit-middle" /><div className="sun"><span>此刻</span><strong>遇见自己</strong></div><span className="leaf leaf-a" /><span className="leaf leaf-b" /><span className="leaf leaf-c" /></div><div className="bottom-panel"><div className="trust-note"><span className="lock" aria-hidden="true" /><span>你的出生资料默认仅自己可见，也可以随时管理</span></div><button className="primary" type="button" onClick={() => setStarted(true)}>开始认识自己 <span aria-hidden="true">→</span></button></div>{started && <div className="sheet-backdrop" role="presentation" onClick={() => setStarted(false)}><section className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><span className="sheet-icon" aria-hidden="true">✦</span><p className="eyebrow">LIFE PROFILE</p><h2 id="sheet-title">先建立你的生命智慧档案</h2><p>大约需要 1 分钟。我们会请你填写出生日期和时间，用于生成属于你的每日内容。</p><button className="primary" type="button" onClick={() => router.push(ROUTES.login)}>手机号登录并建档 <span>→</span></button><button className="sheet-close" type="button" onClick={() => setStarted(false)}>稍后再说</button></section></div>}</RouteFrame>;
}
