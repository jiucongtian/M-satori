"use client";

import { useEffect, useState } from "react";
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
import { RouteFrame } from "@/src/shared/shell";
import { useSession } from "@/src/shared/session";
import { readFlowDraft } from "@/src/shared/storage";
import { PageDebugLabel } from "@/src/shared/ui";

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
  useEffect(()=>{if(!me?.userId)return;const timer=window.setTimeout(()=>setDraft(readFlowDraft<ReadingDraft>("reading",me.userId,1)),0);return()=>window.clearTimeout(timer)},[me?.userId]);
  const requestedCount = Number(searchParams.get("cards")||2);
  const cardCount = Math.min(5,Math.max(1,Number.isFinite(requestedCount)?requestedCount:2));
  const requestedReturn = searchParams.get("from");
  const returnPath = safeReturnPath(requestedReturn, ROUTES.readingHistory);
  const flowPath = (target: ReadingFlowStep) => {
    const destination = `${path[target]}?cards=${cardCount}`;
    return requestedReturn ? withReturnPath(destination, returnPath) : destination;
  };
  const go = (target: ReadingFlowStep | "home" | "history" | "services") => {
    if (target === "home") router.push(ROUTES.readings);
    else if (target === "history") router.push(ROUTES.readingHistory);
    else if (target === "services") router.push(ROUTES.shop);
    else router.push(flowPath(target));
  };

  const screens: Record<ReadingFlowStep, React.ReactNode> = {
    question: <ReadingQuestion onBack={()=>go("home")} onNext={()=>go("spread")}/>,
    confirm: <ReadingConfirm onBack={()=>go("question")} onNext={()=>go("spread")} onSafety={()=>go("question")}/>,
    spread: <ReadingSpread onBack={()=>go("question")} onNext={(count)=>router.push(`${path.payment}?cards=${count}`)}/>,
    config: <ReadingConfig onBack={()=>go("spread")} onNext={()=>go("payment")}/>,
    payment: <ReadingPayment cardCount={cardCount} question={draft?.question} category={draft?.category} positions={cardCount>1?draft?.positions:undefined} onBack={()=>go("question")} onNext={()=>go("shuffle")}/>,
    shuffle: <ReadingShuffle onBack={()=>go("payment")} onNext={()=>go("draw")}/>,
    draw: <ReadingDraw cardCount={cardCount} onBack={()=>go("shuffle")} onNext={()=>go("reveal")}/>,
    reveal: <ReadingReveal cardCount={cardCount} onBack={()=>go("draw")} onNext={()=>go("generating")}/>,
    generating: <ReadingGenerate cardCount={cardCount} onBack={()=>requestedReturn?router.push(returnPath):go("reveal")} onSuccess={()=>go("report")} onFailure={()=>go("failure")} onLeave={()=>requestedReturn?router.push(returnPath):go("history")} onNetworkError={()=>go("failure")}/>,
    report: <ReadingReport cardCount={cardCount} onBack={()=>router.push(returnPath)} onNext={()=>go("home")}/>,
    feedback: <ReadingFeedback onBack={()=>go("report")} onHome={()=>go("home")} onShare={()=>go("report")}/>,
    failure: <ReadingFailure onBack={()=>router.push(returnPath)} onRetry={()=>go("generating")}/>,
  };

  return <ProtectedRoute><RouteFrame title="抽卡问事" label="R1.1 正式主流程"><PageDebugLabel>{`R1.1 · ${pageCode[step]}`}</PageDebugLabel>{screens[step]}</RouteFrame></ProtectedRoute>;
}
