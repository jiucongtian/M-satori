"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ReadingConfig,
  ReadingConfirm,
  ReadingDraw,
  ReadingFailure,
  ReadingFeedback,
  ReadingGenerate,
  ReadingPayment,
  ReadingQuestion,
  ReadingReport,
  ReadingReveal,
  ReadingShuffle,
  ReadingSpread,
} from "@/src/features/legacy/LegacyProfileFlow";
import { ProtectedRoute } from "@/src/shared/guards";
import { ROUTES, safeReturnPath, withReturnPath } from "@/src/shared/routes";
import { RouteError,RouteFrame } from "@/src/shared/shell";
import { useSession } from "@/src/shared/session";
import { readFlowDraft } from "@/src/shared/storage";
import { apiMessage,PageDebugLabel } from "@/src/shared/ui";
import { api,type CardReading } from "@/src/api/client";

type ReadingDraft = { question:string; category:string; cardCount:number; positions:string[] };

export type ReadingFlowStep =
  | "question" | "confirm" | "spread" | "config" | "payment"
  | "shuffle" | "draw" | "reveal" | "generating" | "report"
  | "feedback" | "failure";

const path = {
  question: ROUTES.readingNew,
  confirm: "/readings/confirm",
  spread: "/readings/spread",
  config: "/readings/config",
  payment: "/readings/payment",
  shuffle: "/readings/shuffle",
  draw: "/readings/draw",
  reveal: "/readings/reveal",
  generating: "/readings/generating",
  report: "/readings/report",
  feedback: "/readings/feedback",
  failure: "/readings/failure",
} as const;

const pageCode: Record<ReadingFlowStep,string> = {
  question:"READ-02", confirm:"READ-03", spread:"READ-05", config:"READ-06",
  payment:"READ-09", shuffle:"READ-10", draw:"READ-11", reveal:"READ-12",
  generating:"READ-13", failure:"READ-14", report:"READ-15", feedback:"READ-18",
};

export default function ReadingFlowScreen({ step }: { step: ReadingFlowStep }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const{me}=useSession();
  const[draft,setDraft]=useState<ReadingDraft|null>(null);
  const[reading,setReading]=useState<CardReading|null>(null);const[flowBusy,setFlowBusy]=useState(false);const[flowError,setFlowError]=useState("");
  const generationStartedFor=useRef<string|null>(null);
  useEffect(()=>{if(!me?.userId)return;const timer=window.setTimeout(()=>setDraft(readFlowDraft<ReadingDraft>("reading",me.userId,2)),0);return()=>window.clearTimeout(timer)},[me?.userId]);
  useEffect(()=>{
    if(!me?.userId)return;
    const requested=searchParams.get("readingId");
    const saved=window.sessionStorage.getItem(`fresh:active-reading:${me.userId}`);
    const canRestoreSaved=["draw","reveal","generating","report","feedback","failure"].includes(step);
    const id=requested||(canRestoreSaved?saved:null);
    let active=true;
    if(!id){const timer=window.setTimeout(()=>{if(active)setReading(null)},0);return()=>{active=false;window.clearTimeout(timer)}}
    void api.cardReading(id).then(value=>{if(active)setReading(value)}).catch(()=>{if(saved===id)window.sessionStorage.removeItem(`fresh:active-reading:${me.userId}`)});
    return()=>{active=false};
  },[me?.userId,searchParams,step]);
  const requestedCount = Number(searchParams.get("cards")||2);
  const cardCount = Math.min(5,Math.max(1,Number.isFinite(requestedCount)?requestedCount:2));
  const requestedReturn = searchParams.get("from");
  const returnPath = safeReturnPath(requestedReturn, ROUTES.readingHistory);
  const flowPath = (target: ReadingFlowStep, readingId?: string, overrideCount?: number) => {
    const readingQuery=readingId?`&readingId=${encodeURIComponent(readingId)}`:"";
    const destination = `${path[target]}?cards=${overrideCount??cardCount}${readingQuery}`;
    return requestedReturn ? withReturnPath(destination, returnPath) : destination;
  };
  const go = (target: ReadingFlowStep | "home" | "history" | "services", readingId?: string, overrideCount?: number) => {
    if (target === "home") router.push(ROUTES.readings);
    else if (target === "history") router.push(ROUTES.readingHistory);
    else if (target === "services") router.push(ROUTES.shop);
    else router.push(flowPath(target,readingId,overrideCount));
  };
  async function beginDraw(){if(!me?.userId||!draft||flowBusy)return;setFlowBusy(true);setFlowError("");try{const created=await api.createCardReadingDraw({question:draft.question,category:draft.category,cardCount,positionLabels:draft.positions});setReading(created);window.sessionStorage.setItem(`fresh:active-reading:${me.userId}`,created.readingId);go("draw")}catch(reason){setFlowError(apiMessage(reason))}finally{setFlowBusy(false)}}
  async function retryReading(){if(!reading||flowBusy)return;setFlowBusy(true);setFlowError("");try{const retried=await api.retryCardReading(reading.readingId);setReading(retried);go("generating",retried.readingId,retried.cardCount)}catch(reason){setFlowError(apiMessage(reason))}finally{setFlowBusy(false)}}
  useEffect(()=>{
    if(step!=="generating"||!reading)return;
    if(reading.status==="READY"){router.replace(`${path.report}?readingId=${encodeURIComponent(reading.readingId)}`);return}
    if(reading.status==="FAILED"){router.replace(`${path.failure}?readingId=${encodeURIComponent(reading.readingId)}`);return}
    let active=true;
    if(reading.status==="DRAWN"&&generationStartedFor.current!==reading.readingId){generationStartedFor.current=reading.readingId;void api.completeCardReading(reading.readingId).then(value=>{if(active)setReading(value)}).catch(()=>{if(active)router.replace(`${path.failure}?readingId=${encodeURIComponent(reading.readingId)}`)})}
    const timer=reading.status==="GENERATING"?window.setInterval(()=>{void api.cardReading(reading.readingId).then(value=>{if(active)setReading(value)}).catch(()=>undefined)},2500):undefined;
    return()=>{active=false;if(timer)window.clearInterval(timer)};
  },[reading,router,step]);

  const screens: Record<ReadingFlowStep, React.ReactNode> = {
    question: <ReadingQuestion onBack={()=>go("home")} onNext={()=>go("spread")}/>,
    confirm: <ReadingConfirm onBack={()=>go("question")} onNext={()=>go("spread")} onSafety={()=>go("question")}/>,
    spread: <ReadingSpread onBack={()=>go("question")} onNext={(count)=>router.push(`${path.payment}?cards=${count}`)}/>,
    config: <ReadingConfig onBack={()=>go("spread")} onNext={()=>go("payment")}/>,
    payment: <ReadingPayment cardCount={cardCount} question={draft?.question} category={draft?.category} positions={cardCount>1?draft?.positions:undefined} onBack={()=>go("question")} onNext={()=>go("shuffle")}/>,
    shuffle: <ReadingShuffle onBack={()=>go("payment")} onNext={()=>void beginDraw()}/>,
    draw: <ReadingDraw cardCount={cardCount} onBack={()=>go("shuffle")} onNext={()=>go("reveal")}/>,
    reveal: <ReadingReveal cardCount={cardCount} cards={reading?.cards} onBack={()=>go("draw")} onNext={()=>go("generating")}/>,
    generating: <ReadingGenerate live status={reading?.status??"GENERATING"} cardCount={cardCount} cards={reading?.cards} onBack={()=>requestedReturn?router.push(returnPath):go("reveal")} onSuccess={()=>router.push(`${path.report}?readingId=${encodeURIComponent(reading?.readingId??"")}`)} onFailure={()=>go("failure")} onLeave={()=>requestedReturn?router.push(returnPath):go("history")} onNetworkError={()=>go("failure")}/>,
    report: <ReadingReport live report={reading?.report} cardCount={reading?.cardCount??cardCount} cards={reading?.cards} onBack={()=>router.push(returnPath)} onNext={()=>go("home")} onShare={reading?.readingId&&reading.report?()=>router.push(`/share/generating?type=reading&readingId=${encodeURIComponent(reading.readingId)}`):undefined}/>,
    feedback: <ReadingFeedback onBack={()=>go("report")} onHome={()=>go("home")} onShare={()=>go("report")}/>,
    failure: <ReadingFailure onBack={()=>router.push(returnPath)} onRetry={()=>{generationStartedFor.current=null;void retryReading()}}/>,
  };

  if(flowError)return <RouteError title="本次问事暂时没有继续" message={flowError} backHref={ROUTES.readingHistory}/>;
  return <ProtectedRoute><RouteFrame title="抽卡问事" label="R1.1 正式主流程"><PageDebugLabel>{`R1.1 · ${pageCode[step]}`}</PageDebugLabel>{screens[step]}</RouteFrame></ProtectedRoute>;
}
