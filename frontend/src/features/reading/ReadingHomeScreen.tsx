"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ProtectedRoute } from "@/src/shared/guards";
import { ROUTES } from "@/src/shared/routes";
import { RouteFrame } from "@/src/shared/shell";
import { useSession } from "@/src/shared/session";
import { writeFlowDraft } from "@/src/shared/storage";
import { PageDebugLabel } from "@/src/shared/ui";
import { ReadingHeader, RouteMainNav } from "./ReadingShell";
import { classifyReadingCategory } from "./ReadingNewScreen";

const prompts=[
  "面对现在最牵动我的这件事，我需要看见什么？",
  "我可以怎样理解自己此刻的犹豫？",
  "接下来，我更适合从哪一步开始？",
];

export default function ReadingHomeScreen(){
  const router=useRouter();
  const{me}=useSession();
  const[question,setQuestion]=useState("");
  useEffect(()=>{const reset=()=>document.querySelector<HTMLElement>(".reading-home-scroll")?.scrollTo({top:0,left:0,behavior:"instant"});reset();window.addEventListener("pageshow",reset);return()=>window.removeEventListener("pageshow",reset)},[]);
  const start=()=>{const value=question.trim();if(value.length<6||!me?.userId)return;writeFlowDraft("reading",me.userId,2,{question:value,category:classifyReadingCategory(value),cardCount:1,positions:["自己"]});window.sessionStorage.removeItem(`fresh:reading-request:${me.userId}`);router.push("/readings/shuffle?cards=1")};
  return <ProtectedRoute><RouteFrame title="问事" label="问事首页"><section className="reading-page reading-home root-tab-page"><div className="reading-home-scroll"><PageDebugLabel>R1.1 · READ-01</PageDebugLabel><ReadingHeader/><p className="eyebrow">ASK · DRAW · REFLECT</p><h1>带着一个问题<br/>来听听牌想说什么</h1><p className="reading-lead">写下此刻最关心的事，让一张牌陪你换个角度看见下一步。</p><div className="question-box reading-home-question"><textarea value={question} maxLength={120} placeholder="此刻，你最想问什么？" onChange={event=>setQuestion(event.target.value)} aria-label="输入想问的问题"/><div><small>{question.length} / 120</small><button type="button" onClick={()=>setQuestion("")}>清空</button></div></div><button className="start-reading" type="button" disabled={question.trim().length<6} onClick={start}><span>抽一张牌</span><b>→</b><small>把问题轻轻放在心里</small></button><div className="prompt-list prompt-scenarios"><header><strong>不知道怎么问？</strong><span>试试这些</span></header>{prompts.map((prompt,index)=><button type="button" key={prompt} onClick={()=>setQuestion(prompt)}><span><small>0{index+1}</small>{prompt}</span><b>›</b></button>)}</div><div className="reading-recent"><span><i>续</i><p><strong>最近一次问事</strong><small>完成后会在这里保存</small></p></span><button type="button" onClick={()=>router.push(ROUTES.readingHistory)}>全部记录</button></div></div><RouteMainNav/></section></RouteFrame></ProtectedRoute>;
}
