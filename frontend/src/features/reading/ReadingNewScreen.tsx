"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ProtectedRoute } from "@/src/shared/guards";
import { ROUTES } from "@/src/shared/routes";
import { RouteFrame } from "@/src/shared/shell";
import { useSession } from "@/src/shared/session";
import { readFlowDraft, writeFlowDraft } from "@/src/shared/storage";
import { PageDebugLabel } from "@/src/shared/ui";
import { ReadingHeader } from "./ReadingShell";

type ReadingDraft = { question:string; category:string; cardCount:number; positions:string[] };
const DRAFT_VERSION=2;

export function classifyReadingCategory(question:string){
  const rules=[["情感",/感情|恋爱|伴侣|对象|婚姻|关系|他|她|我们|分手|复合/],["财富",/财富|赚钱|收入|投资|金钱|薪资|财务|生意/],["健康",/健康|身体|睡眠|生病|疼痛|疲惫|焦虑|情绪/],["事业",/事业|工作|职业|职场|公司|同事|老板|项目|创业/],["选择",/选择|决定|要不要|是否|机会|方向|哪个|如何选/],["个人状态",/自己|状态|成长|迷茫|内心|感受|压力|未来/]] as const;
  return rules.find(([,pattern])=>pattern.test(question))?.[0]??"其他";
}

export function positionTemplate(count:number){
  if(count===1)return["自己"];
  if(count===2)return["自己","某人或某事"];
  return["自己",...Array.from({length:count-1},(_,index)=>`选择${["一","二","三","四"][index]}`)];
}

export default function ReadingNewScreen(){
  const router=useRouter();
  const{me}=useSession();
  const owner=me?.userId??"unknown";
  const[question,setQuestion]=useState("");
  const[cardCount,setCardCount]=useState(1);
  const[positions,setPositions]=useState(()=>positionTemplate(1));
  const[restored,setRestored]=useState(false);

  const category=classifyReadingCategory(question);
  useEffect(()=>{if(owner==="unknown"||restored)return;const timer=window.setTimeout(()=>{const draft=readFlowDraft<ReadingDraft>("reading",owner,DRAFT_VERSION);if(draft){setQuestion(draft.question);setCardCount(draft.cardCount);setPositions(positionTemplate(draft.cardCount))}setRestored(true)},0);return()=>window.clearTimeout(timer)},[owner,restored]);
  useEffect(()=>{if(owner==="unknown"||!restored)return;writeFlowDraft("reading",owner,DRAFT_VERSION,{question,category,cardCount,positions})},[owner,restored,question,category,cardCount,positions]);

  function chooseCount(value:number){setCardCount(value);setPositions(positionTemplate(value))}
  const ready=question.trim().length>=6;

  return <ProtectedRoute><RouteFrame title="开始问事" label="问题、牌数与牌位"><section className="reading-page reading-compose"><PageDebugLabel>R1.1 · READ-02</PageDebugLabel><ReadingHeader backHref={ROUTES.readings}/><div className="reading-compose-scroll">
    <section className="compose-section compose-count-first"><header><small>STEP 01</small><h2>这次想用几张牌来看？</h2><p>数量不是越多越好，选择最贴近这次问题的方式。</p></header><div className="compose-counts">{[{count:1,label:"一张",note:"聚焦核心指引"},{count:2,label:"两张",note:"查看双方关系"},{count:3,label:"多张",note:"比较多个选择"}].map(item=>{const active=item.count===3?cardCount>=3:cardCount===item.count;return <button type="button" className={active?"active":""} key={item.count} onClick={()=>chooseCount(item.count)}><span>{item.label}</span><small>{item.note}</small><b>{active?"✓":""}</b></button>})}</div>{cardCount>=3&&<div className="compose-multi-count"><span>具体抽几张？</span>{[3,4,5].map(value=><button type="button" key={value} className={cardCount===value?"active":""} onClick={()=>chooseCount(value)}>{value} 张</button>)}</div>}</section>
    <p className="eyebrow">YOUR QUESTION</p><h1>此刻，你最想问什么？</h1><p className="reading-lead">自然写下你正在关心的事，系统会为这次问事自动归类。</p><div className="question-box"><textarea value={question} maxLength={120} placeholder="例如：面对目前的工作变化，我可以如何找到更适合自己的方向？" onChange={event=>setQuestion(event.target.value)} aria-label="输入想问的问题"/><div><small>{question.length} / 120</small><button type="button" onClick={()=>setQuestion("")}>清空</button></div></div>
    <section className="compose-section position-section"><header><small>这次的牌位</small><h2>{cardCount===1?"自己 · 核心指引":cardCount===2?"我与某人或某事":"自己与不同选择"}</h2><p>每张牌的含义已为你整理好，不需要再额外设置。</p></header><div className="position-summary">{positions.map((value,index)=><span key={value}><b>{index+1}</b>{value}</span>)}</div></section>
    <section className="reading-boundary"><p>卡牌不能代替医疗诊断、投资决策或法律意见；身体不适或其他专业问题，请及时寻求专业帮助。</p><p>更适合问：“面对这件事，我可以如何照顾自己、理解感受并准备下一步？”请勿询问他人的隐私。</p></section>
    <section className="compose-summary"><small>本次问事</small><p><span>系统归类</span><strong>{category}</strong></p><p><span>数量</span><strong>{cardCount} 张牌</strong></p>{cardCount>1&&<p><span>牌位</span><strong>{positions.join(" · ")}</strong></p>}</section>
  </div><button className="primary compose-submit" type="button" disabled={!ready} onClick={()=>{window.sessionStorage.removeItem(`fresh:reading-request:${owner}`);router.push(`/readings/payment?cards=${cardCount}`)}}>确认问题与牌位 <span>→</span></button><p className="next-hint">下一步确认本次使用的问事权益；返回时内容仍会保留</p></section></RouteFrame></ProtectedRoute>;
}
