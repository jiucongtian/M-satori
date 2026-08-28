"use client";

import { useRouter } from "next/navigation";
import { ProtectedRoute } from "@/src/shared/guards";
import { ROUTES } from "@/src/shared/routes";
import { RouteFrame } from "@/src/shared/shell";
import { PageDebugLabel } from "@/src/shared/ui";
import { ReadingHeader, RouteMainNav } from "./ReadingShell";

export default function ReadingHomeScreen(){
  const router=useRouter();
  const prompts=[{count:"一张牌",text:"我想看看，自己当下真正处于怎样的状态？"},{count:"两张牌",text:"在我和他的关系里，我更需要看见什么？"},{count:"多张牌",text:"我收到了三个工作机会，该如何看清它们之间的差异？"}];
  return <ProtectedRoute><RouteFrame title="问事" label="问事首页"><section className="reading-page reading-home root-tab-page"><div className="reading-home-scroll"><PageDebugLabel>R1.1 · READ-01</PageDebugLabel><ReadingHeader/><div className="reading-orbit" aria-hidden="true"><div className="card-stack"><i/><i/><span>问</span></div><b/><b/></div><p className="eyebrow">ASK · DRAW · REFLECT</p><h1>带着一个问题<br/>来听听牌想说什么</h1><p className="reading-lead">它不会替你决定未来，而是陪你换一个角度，看清此刻的自己与下一步。</p><button className="start-reading" type="button" onClick={()=>router.push(ROUTES.readingNew)}><span>开始一次新的问事</span><b>→</b><small>自然写下你正在关心的事</small></button><div className="prompt-list prompt-scenarios"><header><strong>不知道怎么问？</strong><span>试试这些</span></header>{prompts.map(prompt=><button type="button" key={prompt.count} onClick={()=>router.push(ROUTES.readingNew)}><span><small>{prompt.count}</small>{prompt.text}</span><b>›</b></button>)}</div><div className="reading-recent"><span><i>续</i><p><strong>最近一次问事</strong><small>完成后会在这里保存</small></p></span><button type="button" onClick={()=>router.push(ROUTES.readingHistory)}>全部记录</button></div></div><RouteMainNav/></section></RouteFrame></ProtectedRoute>;
}
