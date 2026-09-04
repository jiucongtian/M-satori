"use client";

import { useEffect,useMemo,useRef,useState,type ReactNode } from "react";
import { useRouter,useSearchParams } from "next/navigation";
import { toBlob } from "html-to-image";
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
const titleSets={
  steady:["先稳住心再看世界","呼吸带回内在节奏","把纷扰轻放在身后"],
  change:["允许变化相信自己","答案会在留白生长","慢一点也继续向前"],
  action:["把重要一步走踏实","在真实行动里靠近","看清感受再做选择"],
  relation:["真诚连接也要边界","在关系里看见自己","让理解再靠近彼此"],
  energy:["把能量用在要紧处","顺着节奏安放今天","让今天回到你手中"],
  gentle:["温柔接住此刻自己","给此刻留一片安静","心中微光慢慢亮起"],
} as const;
const bodySets={
  steady:["外界的节奏或许有些纷乱，但你不必跟着加速。先安顿好自己，再回应重要的事。","当心里被许多声音拉扯，先让呼吸慢下来。真正的答案，会在安静里渐渐清晰。","今天无需急着证明什么，把力气留给最重要的一步。守住自己的节奏，就是力量。"],
  change:["变化正在经过你的生活，它不是催促你立刻决定，而是邀请你重新看见想去的方向。","允许答案晚一点出现，也允许自己暂时没有结论。你正在经历的，会沉淀成新的力量。","不必一次解决所有问题，先把眼前这一步走稳。每一次认真回应自己，都在带你向前。"],
  action:["事情越复杂，越要收拢成今天能完成的小动作。清晰不会凭空出现，它会在行动里靠近。","真正的答案不只在想法里，也藏在你愿意迈出的那一步。先行动，方向才会逐渐显现。","先做眼下最重要的选择，不用急着看清整条路。走稳今天这一步，明天自然会有回应。"],
  relation:["靠近彼此的同时，也别忘了照顾自己的感受。关系有了边界，真心才有从容生长的空间。","你不必急着说服任何人，先诚实说出自己的感受。被理解之前，也请允许自己被自己看见。","看见自己的需要，也给彼此留出理解和回应的余地。好的关系，不靠勉强，而靠真诚靠近。"],
  energy:["今天不必把力气分给所有事情，把它留给真正重要的方向。专注一点，你会更有力量。","顺着此刻的状态安排轻重，不勉强自己，也不轻易放弃。适合你的节奏，会带来从容。","能量有高低，重要的是听见身体和内心的提醒。选择合适的步伐，也是在认真照顾自己。"],
  gentle:["为自己留一点真正的安静，让散落的感受重新找到次序。心慢下来以后，你会更清楚。","不必急着得到结论，也不必逼自己立刻想通。答案会在你诚实面对自己时，慢慢靠近。","温柔地接住此刻的自己，不否定感受，也不催促改变。这样的停留，在为下一步积蓄力量。"],
} as const;
type SemanticKey=keyof typeof titleSets;
function semanticKey(value:string|null|undefined):SemanticKey{const text=clean(value);return /合作|关系|沟通|连接|彼此/.test(text)?"relation":/能量|状态|高|低/.test(text)?"energy":/压|稳|节奏|焦虑|紧张/.test(text)?"steady":/变|转|新|成长|经过/.test(text)?"change":/行动|选择|决定|一步|完成/.test(text)?"action":"gentle"}
function posterCopy(sources:Array<string|null|undefined>,angle:number):Copy{const key=semanticKey(sources.map(clean).join(" "));return {title:titleSets[key][angle],body:bodySets[key][angle]}}
export function dailyPosterCopies(insight:DailyInsight):Copy[]{const c=insight.content;return [
  posterCopy([c?.theme,c?.action,c?.insight],0),
  posterCopy([c?.insight,c?.reflectionQuestion,c?.action],1),
  posterCopy([c?.reflectionQuestion,c?.theme,c?.insight],2),
]}
export function readingPosterCopies(reading:CardReading):Copy[]{const subject=clean(reading.category)||"此刻";const cards=reading.cards.map(card=>card.displayName).join("、");return [
  posterCopy([subject,cards],0),
  posterCopy([cards,subject],1),
  posterCopy(["行动选择",subject,cards],2),
]}
function href(path:string,kind:ShareKind,choice:number,date:string|null,readingId:string|null){const q=new URLSearchParams({type:kind,choice:String(choice)});if(date)q.set("date",date);if(readingId)q.set("readingId",readingId);return `${path}?${q}`}

export default function ShareFirstLookScreen({step}:{step:ShareStep}){
  const router=useRouter(),query=useSearchParams();const kind:ShareKind=query.get("type")==="reading"?"reading":"daily";const date=query.get("date"),readingId=query.get("readingId");
  const invalid=(kind==="daily"&&!date)||(kind==="reading"&&!readingId);const[choice,setChoice]=useState(Math.min(2,Math.max(0,Number(query.get("choice")||0))));const[copies,setCopies]=useState<Copy[]|null>(null);const[error,setError]=useState(invalid?"没有找到可以分享的报告。":"");const[saved,setSaved]=useState(false);const[saving,setSaving]=useState(false);const[saveError,setSaveError]=useState("");const[savePreview,setSavePreview]=useState<string|null>(null);
  const reportPath=kind==="daily"&&date?`${ROUTES.dailyReport}?date=${encodeURIComponent(date)}`:kind==="reading"&&readingId?`/readings/report?readingId=${encodeURIComponent(readingId)}`:kind==="daily"?ROUTES.home:ROUTES.readings;
  useEffect(()=>{if(invalid)return;let active=true;const request=kind==="daily"?api.dailyInsight(date!):api.cardReading(readingId!);void request.then(data=>{if(active)setCopies(kind==="daily"?dailyPosterCopies(data as DailyInsight):readingPosterCopies(data as CardReading))}).catch(()=>{if(active)setError("报告暂时无法整理成分享海报，请稍后再试。")});return()=>{active=false}},[date,invalid,kind,readingId]);
  useEffect(()=>{if(step!=="generating"||!copies)return;const timer=window.setTimeout(()=>router.replace(href("/share/select",kind,0,date,readingId)),900);return()=>window.clearTimeout(timer)},[copies,date,kind,readingId,router,step]);
  const item=posters[choice],copy=useMemo(()=>copies?.[choice]??null,[choice,copies]);
  async function save(){const node=document.querySelector<HTMLElement>(".poster-large .fresh-poster");if(!node)return;setSaving(true);setSaveError("");try{await document.fonts.ready;let blob:Blob|null=null;for(const pixelRatio of [2,1.5]){try{blob=await toBlob(node,{cacheBust:true,width:360,height:640,pixelRatio,backgroundColor:"transparent",style:{transform:"none"}});if(blob)break}catch{blob=null}}if(!blob)throw new Error("POSTER_EXPORT_FAILED");const file=new File([blob],`分享初见-${item.id}.png`,{type:"image/png"});if(navigator.share&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:"分享初见"})}else if(/MicroMessenger|iPhone|iPad|Android/i.test(navigator.userAgent)){setSavePreview(URL.createObjectURL(blob))}else{const link=document.createElement("a");link.download=file.name;link.href=URL.createObjectURL(blob);document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(link.href),1000)}setSaved(true);track("share_poster_saved",{result:"success",object_type:kind==="daily"?"daily_insight":"reading",object_id:(kind==="daily"?date:readingId)??undefined,properties:{poster_style:item.id}})}catch(error){if(error instanceof DOMException&&error.name==="AbortError")return;setSaved(false);setSaveError("海报暂时没有保存成功，请稍后重试或更换浏览器打开。");track("share_poster_saved",{result:"failed",reason_code:"POSTER_EXPORT_FAILED",properties:{poster_style:item.id}})}finally{setSaving(false)}}
  if(error)return <RouteError title="暂时无法生成分享海报" message={error} backHref={reportPath}/>;if(!copies||!copy)return <RouteSkeleton label="正在整理报告里的看见…"/>;
  return <ProtectedRoute><RouteFrame title="分享初见" label="分享初见" mode="share-mode">{step==="generating"?<section className="share-generating-new"><div className="share-seed"><span>芽</span></div><p className="eyebrow">A MOMENT FOR YOU</p><h1>正在为你<br/>收藏此刻的看见</h1><p>请稍候，属于你的分享海报正在生成</p><div className="share-progress"><i/></div></section>:step==="select"?<section className="share-select"><ShareHeader onBack={()=>router.push(reportPath)}/><p className="eyebrow">THREE WAYS TO FEEL</p><h1>哪一种，更像<br/>此刻的你？</h1><div className="poster-choices">{posters.map((poster,index)=><button type="button" key={poster.id} onClick={()=>setChoice(index)} className={choice===index?"active":""}><Poster item={poster} copy={copies[index]!} kind={kind}/><span><strong>{poster.name}</strong><small>{poster.note}</small></span><b>{choice===index?"✓":""}</b></button>)}</div><FreshButton className="share-primary" onClick={()=>router.push(href("/share/preview",kind,choice,date,readingId))} trailing="→">预览这张海报</FreshButton></section>:<section className="share-preview"><ShareHeader onBack={()=>router.push(href("/share/select",kind,choice,date,readingId))} action={<FreshButton variant="text" className="share-complete" onClick={()=>router.push(reportPath)}>完成</FreshButton>}/><div className="poster-large"><Poster item={item} copy={copy} kind={kind}/></div><FreshButton className="share-primary" disabled={saving} onClick={()=>void save()} trailing="↓">{saving?"正在生成高清海报…":saved?"再次保存":"保存高清海报"}</FreshButton>{saveError?<p className="share-save-error" role="alert">{saveError}</p>:<p>保存后即可分享给朋友或发布到朋友圈</p>}{savePreview&&<div className="share-save-sheet" role="dialog" aria-modal="true" aria-label="保存分享海报"><button type="button" onClick={()=>{URL.revokeObjectURL(savePreview);setSavePreview(null)}}>关闭</button><p>长按图片，选择“保存到手机”</p><img src={savePreview} alt="可长按保存的分享海报"/></div>}</section>}</RouteFrame></ProtectedRoute>
}
function ShareHeader({onBack,action}:{onBack:()=>void;action?:ReactNode}){return <header className="share-header"><BackButton onClick={onBack}/><strong>分享初见</strong>{action??<span/>}</header>}
function Poster({item,copy,kind}:{item:typeof posters[number];copy:Copy;kind:ShareKind}){const frame=useRef<HTMLDivElement>(null);const[scale,setScale]=useState(1);useEffect(()=>{const element=frame.current;if(!element)return;const resize=()=>setScale(element.clientWidth/360);resize();const observer=new ResizeObserver(resize);observer.observe(element);return()=>observer.disconnect()},[]);const repaired=mergeShortTail(copy.title);return <div ref={frame} className="poster-viewport"><article className={`fresh-poster poster-layout-${item.layout}${repaired!==copy.title?" poster-tail-merged":""}`} style={{backgroundImage:`url(${item.image})`,transform:`scale(${scale})`}}><Brand compact/><small className="poster-report-kind">{kind==="daily"?"初见·今日":"初见·问事"}</small><div className="poster-message"><h2>{repaired}</h2><p>{copy.body}</p></div><footer><img src="/share/fresh-entry-qr.png" alt="初见注册链接二维码"/><strong>获得你的初见</strong></footer></article></div>}
export function mergeShortTail(value:string){const lines=value.split("\n"),tail=lines.at(-1)?.trim()??"";return lines.length<2||!tail||tail.length>3?value:[...lines.slice(0,-2),`${lines.at(-2)??""}${tail}`].join("\n")}
