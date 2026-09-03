"use client";

import { useEffect,useMemo,useState,type ReactNode } from "react";
import { useRouter,useSearchParams } from "next/navigation";
import { toPng } from "html-to-image";
import { track } from "@/src/analytics/client";
import { api,type CardReading,type DailyInsight } from "@/src/api/client";
import { BackButton,FreshButton } from "@/src/components/FreshPrimitives";
import { ProtectedRoute } from "@/src/shared/guards";
import { ROUTES } from "@/src/shared/routes";
import { RouteError,RouteFrame,RouteSkeleton } from "@/src/shared/shell";
import { Brand } from "@/src/shared/ui";
import "./share-first-look.css";

type ShareKind="daily"|"reading"; type ShareStep="generating"|"select"|"preview"; type Copy={title:string;body:string};
const posters=[
  {id:"natural",layout:"poetic",name:"自然疗愈",note:"像晨光一样松弛",image:"/share/2026-W36/natural-healing-master.png"},
  {id:"oriental",layout:"centered",name:"东方留白",note:"留一点安静给自己",image:"/share/2026-W36/oriental-whitespace-master.png"},
  {id:"abstract",layout:"editorial",name:"抽象情绪",note:"让变化慢慢流动",image:"/share/2026-W36/abstract-emotion-master.png"},
] as const;
const clean=(value:string|null|undefined)=>(value??"").replace(/\s+/g," ").replace(/[“”]/g,"").trim();
function sentence(value:string|null|undefined,max=40){const first=clean(value).split(/[。！？；]/).find(Boolean)??"";return first.length>max?`${first.slice(0,max-1)}…`:first}
function headline(value:string|null|undefined,fallback:string){const text=sentence(value,22)||fallback;if(text.length<=11)return text;const middle=Math.ceil(text.length/2);return `${text.slice(0,middle)}\n${text.slice(middle)}`}
export function dailyPosterCopies(insight:DailyInsight):Copy[]{const c=insight.content;return [
  {title:headline(c?.theme,"先稳住自己，再回应世界"),body:sentence(c?.action)||"把今天真正重要的一步，轻轻放回自己手里。"},
  {title:headline(c?.insight,c?.theme||"答案会在留白里慢慢长出来"),body:sentence(c?.reflectionQuestion)||sentence(c?.action)},
  {title:headline(c?.reflectionQuestion,c?.theme||"允许变化经过，也相信自己站稳"),body:sentence(c?.insight)||sentence(c?.action)},
]}
export function readingPosterCopies(reading:CardReading):Copy[]{const subject=clean(reading.category)||"此刻";const cards=reading.cards.map(card=>card.displayName).join("、");return [
  {title:"变化不是催你离开",body:`${subject}里的答案不必仓促。看清什么值得保留，方向会在诚实的选择里出现。`},
  {title:"不必守住\n过去的答案",body:`${cards?`${cards}带来的看见，`:"这次看见提醒你，"}为自己留一点安静，清晰会慢慢长出来。`},
  {title:"下一步\n只验证一件事",body:"把复杂收拢成一个今天能完成的小动作，让答案在真实行动里靠近。"},
]}
function href(path:string,kind:ShareKind,choice:number,date:string|null,readingId:string|null){const q=new URLSearchParams({type:kind,choice:String(choice)});if(date)q.set("date",date);if(readingId)q.set("readingId",readingId);return `${path}?${q}`}

export default function ShareFirstLookScreen({step}:{step:ShareStep}){
  const router=useRouter(),query=useSearchParams();const kind:ShareKind=query.get("type")==="reading"?"reading":"daily";const date=query.get("date"),readingId=query.get("readingId");
  const invalid=(kind==="daily"&&!date)||(kind==="reading"&&!readingId);const[choice,setChoice]=useState(Math.min(2,Math.max(0,Number(query.get("choice")||0))));const[copies,setCopies]=useState<Copy[]|null>(null);const[error,setError]=useState(invalid?"没有找到可以分享的报告。":"");const[saved,setSaved]=useState(false);
  const reportPath=kind==="daily"&&date?`${ROUTES.dailyReport}?date=${encodeURIComponent(date)}`:kind==="reading"&&readingId?`/readings/report?readingId=${encodeURIComponent(readingId)}`:kind==="daily"?ROUTES.home:ROUTES.readings;
  useEffect(()=>{if(invalid)return;let active=true;const request=kind==="daily"?api.dailyInsight(date!):api.cardReading(readingId!);void request.then(data=>{if(active)setCopies(kind==="daily"?dailyPosterCopies(data as DailyInsight):readingPosterCopies(data as CardReading))}).catch(()=>{if(active)setError("报告暂时无法整理成分享海报，请稍后再试。")});return()=>{active=false}},[date,invalid,kind,readingId]);
  useEffect(()=>{if(step!=="generating"||!copies)return;const timer=window.setTimeout(()=>router.replace(href("/share/select",kind,0,date,readingId)),900);return()=>window.clearTimeout(timer)},[copies,date,kind,readingId,router,step]);
  const item=posters[choice],copy=useMemo(()=>copies?.[choice]??null,[choice,copies]);
  async function save(){const node=document.querySelector<HTMLElement>(".poster-large .fresh-poster");if(!node)return;try{await document.fonts.ready;const dataUrl=await toPng(node,{cacheBust:true,pixelRatio:1080/node.clientWidth,backgroundColor:"transparent"});const link=document.createElement("a");link.download=`分享初见-${item.id}.png`;link.href=dataUrl;link.click();setSaved(true);track("share_poster_saved",{result:"success",object_type:kind==="daily"?"daily_insight":"reading",object_id:(kind==="daily"?date:readingId)??undefined,properties:{poster_style:item.id}})}catch{setSaved(false);track("share_poster_saved",{result:"failed",reason_code:"POSTER_EXPORT_FAILED",properties:{poster_style:item.id}})}}
  if(error)return <RouteError title="暂时无法生成分享海报" message={error} backHref={reportPath}/>;if(!copies||!copy)return <RouteSkeleton label="正在整理报告里的看见…"/>;
  return <ProtectedRoute><RouteFrame title="分享初见" label="分享初见" mode="share-mode">{step==="generating"?<section className="share-generating-new"><div className="share-seed"><span>芽</span></div><p className="eyebrow">A MOMENT FOR YOU</p><h1>正在为你<br/>收藏此刻的看见</h1><p>请稍候，属于你的分享海报正在生成</p><div className="share-progress"><i/></div></section>:step==="select"?<section className="share-select"><ShareHeader onBack={()=>router.push(reportPath)}/><p className="eyebrow">THREE WAYS TO FEEL</p><h1>哪一种，更像<br/>此刻的你？</h1><div className="poster-choices">{posters.map((poster,index)=><button type="button" key={poster.id} onClick={()=>setChoice(index)} className={choice===index?"active":""}><Poster item={poster} copy={copies[index]!} kind={kind}/><span><strong>{poster.name}</strong><small>{poster.note}</small></span><b>{choice===index?"✓":""}</b></button>)}</div><FreshButton className="share-primary" onClick={()=>router.push(href("/share/preview",kind,choice,date,readingId))} trailing="→">预览这张海报</FreshButton></section>:<section className="share-preview"><ShareHeader onBack={()=>router.push(href("/share/select",kind,choice,date,readingId))} action={<FreshButton variant="text" className="share-complete" onClick={()=>router.push(reportPath)}>完成</FreshButton>}/><div className="poster-large"><Poster item={item} copy={copy} kind={kind}/></div><FreshButton className="share-primary" onClick={()=>void save()} trailing="↓">{saved?"已保存，再保存一次":"保存高清海报"}</FreshButton><p>保存到相册后，即可分享给朋友或发布到朋友圈</p></section>}</RouteFrame></ProtectedRoute>
}
function ShareHeader({onBack,action}:{onBack:()=>void;action?:ReactNode}){return <header className="share-header"><BackButton onClick={onBack}/><strong>分享初见</strong>{action??<span/>}</header>}
function Poster({item,copy,kind}:{item:typeof posters[number];copy:Copy;kind:ShareKind}){const repaired=mergeShortTail(copy.title);const fit=repaired.replace(/\s/g,"").length+copy.body.length>54?"compact":"airy";return <article className={`fresh-poster poster-layout-${item.layout} poster-fit-${fit}${repaired!==copy.title?" poster-tail-merged":""}`} style={{backgroundImage:`url(${item.image})`}}><Brand compact/><small className="poster-report-kind">{kind==="daily"?"初见·今日":"初见·问事"}</small><div className="poster-message"><h2>{repaired}</h2><p>{copy.body}</p></div><footer><img src="/share/fresh-entry-qr.png" alt="初见注册链接二维码"/><strong>获得你的初见</strong></footer></article>}
export function mergeShortTail(value:string){const lines=value.split("\n"),tail=lines.at(-1)?.trim()??"";return lines.length<2||!tail||tail.length>3?value:[...lines.slice(0,-2),`${lines.at(-2)??""}${tail}`].join("\n")}
