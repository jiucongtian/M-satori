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

type PositionMode = "recommended" | "timeline" | "options" | "custom";
type ReadingDraft = { question:string; category:string; cardCount:number; mode:PositionMode; positions:string[] };
const DRAFT_VERSION=1;

export function classifyReadingCategory(question:string){
  const rules=[["情感",/感情|恋爱|伴侣|对象|婚姻|关系|他|她|我们|分手|复合/],["财富",/财富|赚钱|收入|投资|金钱|薪资|财务|生意/],["健康",/健康|身体|睡眠|生病|疼痛|疲惫|焦虑|情绪/],["事业",/事业|工作|职业|职场|公司|同事|老板|项目|创业/],["选择",/选择|决定|要不要|是否|机会|方向|哪个|如何选/],["个人状态",/自己|状态|成长|迷茫|内心|感受|压力|未来/]] as const;
  return rules.find(([,pattern])=>pattern.test(question))?.[0]??"其他";
}

function positionTemplate(category:string,count:number,mode:PositionMode){
  if(count===1)return["此刻最需要看见的提醒"];
  if(mode==="timeline")return["过去","现在","未来","接下来","更长远的方向"].slice(0,count);
  if(mode==="options")return Array.from({length:count},(_,index)=>`选择 ${String.fromCharCode(65+index)}`);
  if(mode==="custom")return Array.from({length:count},(_,index)=>`第 ${index+1} 张牌`);
  if(category==="情感")return["我","对方","这段关系的现状","需要共同看见的事","下一步"].slice(0,count);
  if(category==="选择")return Array.from({length:count},(_,index)=>`选择 ${String.fromCharCode(65+index)}`);
  if(count===2)return["当前的状态","可以采取的行动"];
  return["事情的现状","形成的原因","需要看见的重点","可以尝试的方向","下一步行动"].slice(0,count);
}

export default function ReadingNewScreen(){
  const router=useRouter();
  const{me}=useSession();
  const owner=me?.userId??"unknown";
  const[question,setQuestion]=useState("");
  const[cardCount,setCardCount]=useState(1);
  const[mode,setMode]=useState<PositionMode>("recommended");
  const[positions,setPositions]=useState(()=>positionTemplate("其他",1,"recommended"));
  const[restored,setRestored]=useState(false);

  const category=classifyReadingCategory(question);
  useEffect(()=>{if(owner==="unknown"||restored)return;const timer=window.setTimeout(()=>{const draft=readFlowDraft<ReadingDraft>("reading",owner,DRAFT_VERSION);if(draft){setQuestion(draft.question);setCardCount(draft.cardCount);setMode(draft.mode);setPositions(draft.positions)}setRestored(true)},0);return()=>window.clearTimeout(timer)},[owner,restored]);
  useEffect(()=>{if(owner==="unknown"||!restored)return;writeFlowDraft("reading",owner,DRAFT_VERSION,{question,category,cardCount,mode,positions})},[owner,restored,question,category,cardCount,mode,positions]);

  function chooseCount(value:number){setCardCount(value);setMode("recommended");setPositions(positionTemplate(category,value,"recommended"))}
  function chooseMode(value:PositionMode){setMode(value);setPositions(positionTemplate(category,cardCount,value))}
  function editPosition(index:number,value:string){setMode("custom");setPositions(current=>current.map((item,itemIndex)=>itemIndex===index?value:item))}
  const ready=question.trim().length>=6&&(cardCount===1||(positions.length===cardCount&&positions.every(value=>value.trim().length>0)));

  return <ProtectedRoute><RouteFrame title="开始问事" label="问题、牌数与牌位"><section className="reading-page reading-compose"><PageDebugLabel>R1.1 · READ-02</PageDebugLabel><ReadingHeader backHref={ROUTES.readings}/><div className="reading-compose-scroll">
    <section className="compose-section compose-count-first"><header><small>STEP 01</small><h2>这次想用几张牌来看？</h2><p>数量不是越多越好，选择最贴近这次感受的方式。</p></header><div className="compose-counts">{[{count:1,label:"一张",note:"聚焦一份核心提醒"},{count:2,label:"两张",note:"看双方、两面或两个选择"},{count:3,label:"多张",note:"展开时间、人物或多个方案"}].map(item=>{const active=item.count===3?cardCount>=3:cardCount===item.count;return <button type="button" className={active?"active":""} key={item.count} onClick={()=>chooseCount(item.count)}><span>{item.label}</span><small>{item.note}</small><b>{active?"✓":""}</b></button>})}</div>{cardCount>=3&&<div className="compose-multi-count"><span>具体抽几张？</span>{[3,4,5].map(value=><button type="button" key={value} className={cardCount===value?"active":""} onClick={()=>chooseCount(value)}>{value} 张</button>)}</div>}</section>
    <p className="eyebrow">YOUR QUESTION</p><h1>此刻，你最想问什么？</h1><p className="reading-lead">自然写下你正在关心的事，系统会为这次问事自动归类。</p><div className="question-box"><textarea value={question} maxLength={120} placeholder="例如：面对目前的工作变化，我可以如何找到更适合自己的方向？" onChange={event=>{const next=event.target.value;setQuestion(next);if(mode==="recommended")setPositions(positionTemplate(classifyReadingCategory(next),cardCount,mode))}} aria-label="输入想问的问题"/><div><small>{question.length} / 120</small><button type="button" onClick={()=>setQuestion("")}>清空</button></div></div>
    {cardCount>1&&<section className="compose-section position-section"><header><small>STEP 02</small><h2>每张牌分别代表什么？</h2><p>系统结合你的问题给出建议，你可以直接确认，也可以修改。</p></header><div className="position-modes">{([['recommended','为我推荐'],['timeline','按时间展开'],['options','比较多个选择'],['custom','自己定义']] as [PositionMode,string][]).map(([value,label])=><button type="button" key={value} className={mode===value?"active":""} onClick={()=>chooseMode(value)}>{label}</button>)}</div><div className="position-editor">{positions.map((value,index)=><label key={index}><span>第 {index+1} 张</span><input value={value} maxLength={20} aria-label={`第 ${index+1} 张牌的含义`} onChange={event=>editPosition(index,event.target.value)}/></label>)}</div></section>}
    <section className="compose-summary"><small>本次问事</small><p><span>系统归类</span><strong>{category}</strong></p><p><span>数量</span><strong>{cardCount} 张牌</strong></p>{cardCount>1&&<p><span>牌位</span><strong>{positions.join(" · ")}</strong></p>}</section>
  </div><button className="primary compose-submit" type="button" disabled={!ready} onClick={()=>router.push(`/readings/payment?cards=${cardCount}`)}>确认问题{cardCount>1?"与牌位":""} <span>→</span></button><p className="next-hint">下一步确认本次使用的问事权益；返回时内容仍会保留</p></section></RouteFrame></ProtectedRoute>;
}
