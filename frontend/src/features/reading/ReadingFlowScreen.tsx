"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ReadingDraw,
  ReadingFailure,
  ReadingGenerate,
  ReadingReport,
  ReadingReveal,
  ReadingShuffle,
} from "./ReadingScreens";
import { ProtectedRoute } from "@/src/shared/guards";
import { ROUTES, safeReturnPath, withReturnPath } from "@/src/shared/routes";
import { RouteError,RouteFrame,RouteSkeleton } from "@/src/shared/shell";
import { useSession } from "@/src/shared/session";
import { readFlowDraft } from "@/src/shared/storage";
import { apiMessage,PageDebugLabel } from "@/src/shared/ui";
import { api,type CardReading } from "@/src/api/client";
import { ReadingPaymentScreen } from "./ReadingPaymentScreen";
import { ReadingFeedbackScreen } from "./ReadingFeedbackScreen";

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
  const[draftLoaded,setDraftLoaded]=useState(false);
  const[reading,setReading]=useState<CardReading|null>(null);const[flowBusy,setFlowBusy]=useState(false);const[flowError,setFlowError]=useState("");
  const generationStartedFor=useRef<string|null>(null);
  const [drawRequestKey, setDrawRequestKey] = useState("");
  useEffect(() => {
    if (!me?.userId || !draft) return;
    const storageKey = `fresh:reading-request:${me.userId}`;
    const fingerprint = JSON.stringify(draft);
    let saved: { fingerprint: string; key: string } | null = null;
    try { saved = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null"); } catch { /* Replace invalid local draft metadata. */ }
    const key = saved?.fingerprint === fingerprint ? saved.key : crypto.randomUUID();
    window.sessionStorage.setItem(storageKey, JSON.stringify({ fingerprint, key }));
    const timer = window.setTimeout(() => setDrawRequestKey(key), 0);
    return () => window.clearTimeout(timer);
  }, [draft, me?.userId]);
  useEffect(()=>{if(!me?.userId)return;const timer=window.setTimeout(()=>{setDraft(readFlowDraft<ReadingDraft>("reading",me.userId,2));setDraftLoaded(true)},0);return()=>window.clearTimeout(timer)},[me?.userId]);
  useEffect(()=>{if(["question","confirm","spread","config"].includes(step))router.replace(withReturnPath(ROUTES.readingNew,safeReturnPath(searchParams.get("from"),ROUTES.readingHistory)))},[step,router,searchParams]);
  useEffect(()=>{
    if(!me?.userId)return;
    const requested=searchParams.get("readingId");
    const saved=window.sessionStorage.getItem(`fresh:active-reading:${me.userId}`);
    const canRestoreSaved=["draw","reveal","generating","report","feedback","failure"].includes(step);
    const id=requested||(canRestoreSaved?saved:null);
    let active=true;
    if(!id){const timer=window.setTimeout(()=>{if(active){setReading(null);if(canRestoreSaved)setFlowError("没有找到本次问事，请从问事记录继续，或发起一次新的问事。")}},0);return()=>{active=false;window.clearTimeout(timer)}}
    void api.cardReading(id).then(value=>{if(active)setReading(value)}).catch(reason=>{if(active)setFlowError(apiMessage(reason))});
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
  async function beginDraw(){if(!me?.userId||!draft||!drawRequestKey||flowBusy)return;setFlowBusy(true);setFlowError("");try{const created=await api.createCardReadingDraw({question:draft.question,category:draft.category,cardCount,positionLabels:draft.positions},drawRequestKey);setReading(created);window.sessionStorage.setItem(`fresh:active-reading:${me.userId}`,created.readingId);go("draw",created.readingId)}catch(reason){setFlowError(apiMessage(reason))}finally{setFlowBusy(false)}}
  async function retryReading(){if(!reading||flowBusy)return;setFlowBusy(true);setFlowError("");try{const retried=await api.retryCardReading(reading.readingId);setReading(retried);go("generating",retried.readingId,retried.cardCount)}catch(reason){setFlowError(apiMessage(reason))}finally{setFlowBusy(false)}}
  useEffect(()=>{
    if(step!=="generating"||!reading)return;
    const destination = (target: "report" | "failure") => withReturnPath(`${path[target]}?readingId=${encodeURIComponent(reading.readingId)}&cards=${reading.cardCount}`, returnPath);
    if(reading.status==="READY"){router.replace(destination("report"));return}
    if(reading.status==="FAILED"){router.replace(destination("failure"));return}
    let active=true;
    if(reading.status==="DRAWN"&&generationStartedFor.current!==reading.readingId){generationStartedFor.current=reading.readingId;void api.completeCardReading(reading.readingId).then(value=>{if(active)setReading(value)}).catch(reason=>{if(active)setFlowError(apiMessage(reason))})}
    const timer=["DRAWN","GENERATING"].includes(reading.status)?window.setInterval(()=>{void api.cardReading(reading.readingId).then(value=>{if(active)setReading(value)}).catch(reason=>{if(active)setFlowError(apiMessage(reason))})},2500):undefined;
    return()=>{active=false;if(timer)window.clearInterval(timer)};
  },[reading,router,step,returnPath]);

  const screens: Record<ReadingFlowStep, React.ReactNode> = {
    question: null,
    confirm: null,
    spread: null,
    config: null,
    payment: drawRequestKey ? <ReadingPaymentScreen cardCount={cardCount} question={draft?.question} requestKey={drawRequestKey} onBack={()=>go("question")} onNext={()=>go("shuffle")}/> : null,
    shuffle: <ReadingShuffle onBack={()=>go("payment")} onNext={()=>void beginDraw()}/>,
    draw: <ReadingDraw cardCount={cardCount} onBack={()=>go("shuffle")} onNext={()=>go("reveal")}/>,
    reveal: <ReadingReveal cardCount={cardCount} cards={reading?.cards} onBack={()=>go("draw")} onNext={()=>go("generating")}/>,
    generating: <ReadingGenerate status={reading?.status??"GENERATING"} cardCount={reading?.cardCount??cardCount} cards={reading?.cards??[]} onBack={()=>requestedReturn?router.push(returnPath):go("reveal")} onLeave={()=>requestedReturn?router.push(returnPath):go("history")}/>,
    report: <ReadingReport report={reading?.report} question={reading?.question} cardCount={reading?.cardCount??cardCount} cards={reading?.cards} onBack={()=>router.push(returnPath)} onNext={()=>go("home")} onFeedback={reading?.status === "READY"?()=>go("feedback",reading.readingId,reading.cardCount):undefined} onShare={reading?.readingId&&reading.report?()=>router.push(`/share/generating?type=reading&readingId=${encodeURIComponent(reading.readingId)}`):undefined}/>,
    feedback: reading?.status === "READY" ? <ReadingFeedbackScreen readingId={reading.readingId} onBack={()=>go("report", reading.readingId, reading.cardCount)} onDone={()=>go("home")}/> : null,
    failure: <ReadingFailure onBack={()=>router.push(returnPath)} onRetry={()=>{generationStartedFor.current=null;void retryReading()}}/>,
  };

  if(flowError)return <ProtectedRoute><RouteError title="本次问事暂时没有继续" message={flowError} onRetry={()=>window.location.reload()} backHref={ROUTES.readingHistory}/></ProtectedRoute>;
  if(["payment","shuffle"].includes(step)&&draftLoaded&&!draft)return <ProtectedRoute><RouteError message="问事草稿已失效，请重新填写问题。" backHref={ROUTES.readingNew}/></ProtectedRoute>;
  if(["draw","reveal","generating","report","feedback","failure"].includes(step)&&!reading)return <ProtectedRoute><RouteSkeleton label="正在恢复问事记录…"/></ProtectedRoute>;
  if(["report","feedback"].includes(step)&&reading?.status!=="READY")return <ProtectedRoute><RouteError message="报告尚未完成，请从问事记录查看进度或继续生成。" backHref={ROUTES.readingHistory}/></ProtectedRoute>;
  return <ProtectedRoute><RouteFrame title="抽卡问事" label="R1.1 正式主流程"><PageDebugLabel>{`R1.1 · ${pageCode[step]}`}</PageDebugLabel>{screens[step]}</RouteFrame></ProtectedRoute>;
}
