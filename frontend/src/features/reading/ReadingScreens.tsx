"use client";

import { useEffect, useState } from "react";
import type { CardReadingCard, CardReadingReport } from "@/src/api/client";
import { ReadingHeader } from "./ReadingShell";
import { XiaosuiAvatar } from "@/src/features/daily/DailyReportScreen";
import { CARD_ASSET_BY_CODE } from "./cardAssets";

export function ReadingStep({ onBack, eyebrow, title, lead, children, action, onNext }: { onBack: () => void; eyebrow: string; title: React.ReactNode; lead?: string; children: React.ReactNode; action?: string; onNext?: () => void }) {
  return <section className="reading-page reading-step"><ReadingHeader onBack={onBack} /><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{lead && <p className="reading-lead">{lead}</p>}<div className="reading-step-body">{children}</div>{action && onNext && <button className="primary" type="button" onClick={onNext}>{action}<span>→</span></button>}</section>;
}

export function ReadingShuffle({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const deck=Array.from({length:17},(_,i)=>{const offset=i-8;return <i key={offset} style={{"--i":offset,"--rotation":`${offset*4.75}deg`} as React.CSSProperties}>{offset===8&&<span className="card-mark">福</span>}</i>;});
  return <section className="reading-page immersive-reading reading-action-page"><ReadingHeader onBack={onBack}/><p className="eyebrow">YOUR QUESTION · 准备抽卡</p><h1>把此刻关心的事<br/>轻轻放在心里</h1><p>不需要说出来。深呼吸一次，<br/>准备好后，抽一张牌。</p><div className="draw-deck-stage poc-draw-idle" aria-hidden="true" onClick={onNext}><div className="draw-deck">{deck}</div></div><button className="primary" onClick={onNext}>抽一张牌 <span>→</span></button><small>点击牌面也可以抽牌</small></section>;
}

export function ReadingDraw({ cards=[], onNext }: { cardCount?:number; cards?:CardReadingCard[]; onNext: () => void; onBack?: () => void }) {
  const card=cards[0]; const [picked]=useState(()=>Math.floor(Math.random()*17)-8); const [animationDone,setAnimationDone]=useState(false); const angle=picked*4.75; const originX=Math.sin(angle*Math.PI/180)*192; const pullDuration=3.1+Math.abs(originX)*.004; const markedOffset=picked===8?7:8; const ready=animationDone&&!!card;
  useEffect(()=>{const timer=window.setTimeout(()=>setAnimationDone(true),pullDuration*1000+1550);return()=>window.clearTimeout(timer)},[pullDuration]);
  return <section className="reading-page reading-action-page single-draw-result"><ReadingHeader/><p className="eyebrow">THE CARD FOUND YOU</p><h1>{ready?"这张牌与你相遇":"正在从牌堆中抽取…"}</h1><div className="draw-deck-stage" aria-label="正在抽取卡牌"><div className="draw-deck">{Array.from({length:17},(_,i)=>{const offset=i-8;const selected=offset===picked;return <i key={offset} className={selected?"is-picked extracted-card":""} style={{"--i":offset,"--rotation":`${offset*4.75}deg`,"--pull-duration":`${pullDuration}s`} as React.CSSProperties}>{selected?<div className="draw-card-inner"><div className="draw-card-back"><span>福</span></div><div className="draw-card-front">{card?<img src={`/cards/satori-default-v1/${CARD_ASSET_BY_CODE[card.cardCode] ?? card.cardCode.toLowerCase().replaceAll("_", "") + ".jpg"}`} alt={card.displayName}/>:<span>福</span>}</div></div>:offset===markedOffset&&<span className="card-mark">福</span>}</i>})}</div></div><p className="draw-card-caption" aria-hidden="true"></p>{ready&&<button className="primary draw-interpret" onClick={onNext}>开始解读 <span>→</span></button>}</section>;
}
export function ReadingReveal({ cardCount=2, cards=[], onBack, onNext }: { cardCount?:number; cards?:CardReadingCard[]; onBack: () => void; onNext: () => void }) {
  return <ReadingStep onBack={onBack} eyebrow="THE CARD FOUND YOU" title="这张牌回应了你的问题" lead="卡牌已经确定，翻开后将用于生成本次报告。" action="看看此刻的答案" onNext={onNext}><div className={`card-layout report-card-gallery reveal-card-gallery count-${cardCount}`}>{cards.map(card=><figure key={card.cardCode}><img src={`/cards/satori-default-v1/${CARD_ASSET_BY_CODE[card.cardCode] ?? card.cardCode.toLowerCase().replaceAll("_", "") + ".jpg"}`} alt={`${card.displayName}生命智慧卡牌`}/></figure>)}</div><div className="frozen-note"><span>封</span><p><strong>本次输入即将冻结</strong>问题、抽牌方式与全部卡牌会被共同保存。</p></div></ReadingStep>;
}

export function ReadingFailure({ onBack, onRetry }: { onBack: () => void; onRetry: () => void }) {
  return <ReadingStep onBack={onBack} eyebrow="PAUSED, NOT LOST" title={<>报告暂时没有长成</>} lead="问题、卡牌和抽取结果都已安全保存，不需要重新抽牌。"><div className="failure-seed"><span>●</span><i/></div><div className="failure-card"><p><strong>本次使用记录已安全保存</strong></p><span><b>01</b>当前结算状态以服务端记录为准</span><span><b>02</b>重新生成不会重复核销</span><span><b>03</b>超过处理时间会按规则自动恢复</span></div><button className="primary" onClick={onRetry}>使用原卡牌重新生成 <span>↻</span></button><button className="text-action" onClick={onBack}>稍后在问事历史继续</button></ReadingStep>;
}

export function ReadingGenerate({ status, cardCount, cards, onLeave }: { status: string; cardCount: number; cards: CardReadingCard[]; onLeave: () => void; onBack?: () => void }) {
  const ready=status==="READY";
  return <section className="reading-page reading-generating reading-action-page"><ReadingHeader/><div className={`card-layout generation-card-stage count-${cardCount}`}>{cards.map((card,i)=><figure key={card.cardCode}><img src={`/cards/satori-default-v1/${CARD_ASSET_BY_CODE[card.cardCode] ?? card.cardCode.toLowerCase().replaceAll("_", "") + ".jpg"}`} alt={`第 ${i+1} 张${card.displayName}生命智慧卡牌`}/></figure>)}</div><div className="generation-list"><span className="done">✓ 已确认问题与 {cardCount} 张卡牌</span><span className="done">✓ 已同步抽牌结果</span><span className="done">✓ 正在读懂这 {cardCount} 张牌</span><span className={ready?"done":"active"}>{ready?"✓":"·"} 正在整理问事报告</span></div><p>{ready?"即将自动打开报告详情":"真实解读通常需要几分钟，可以先离开，完成后会保存在问事记录中"}</p><button className="outline-button" onClick={onLeave}>稍后查看问事记录</button></section>;
}

function reportSections(value:string){
  const clean=value.replace(/\r/g,"").trim();
  if(!clean)return[];
  const blocks=clean.split(/\n{2,}|\n(?=#{1,4}\s+)/).map(item=>item.trim()).filter(Boolean);
  const sections:{content:string}[]=[];
  for(const block of blocks){
    const content=block.replace(/^(?:#{1,4}\s*|\*{1,2})?(?:第?[一二三四五六七八九十\d]+[章节部分、.．：:]\s*)?/u,"").replace(/\*{1,2}$/u,"").trim();
    if(!content)continue;
    const previous=sections.at(-1);
    if(previous&&previous.content.replace(/\s/g,"").length<72)previous.content=`${previous.content}\n\n${content}`;
    else sections.push({content});
  }
  if(!sections.length)sections.push({content:clean});
  if(sections.length>1&&sections.at(-1)!.content.replace(/\s/g,"").length<72){const tail=sections.pop()!;sections.at(-1)!.content+=`\n\n${tail.content}`}
  while(sections.length>9){const tail=sections.pop()!;sections[sections.length-1]!.content+=`\n\n${tail.content}`}
  return sections.map((section,index)=>({title:reportSectionTitle(index),content:section.content}));
}

function reportSectionTitle(index:number){
  return reportStoryTitles[Math.min(index,reportStoryTitles.length-1)]!;
}

function readingReportTitle(raw:string|undefined,question:string|undefined){
  const source=`${raw??""} ${question??""}`.replace(/offer/gi,"选择");
  if(/选择|决定|方向|机会/.test(source))return<>在不同选择之间<br/>看见真正适合自己的方向</>;
  if(/关系|感情|对方|彼此/.test(source))return<>在这段关系里<br/>重新听见自己的感受</>;
  if(/工作|事业|职场/.test(source))return<>在变化之中<br/>找回属于自己的位置</>;
  return<>让牌陪你看见<br/>此刻真正重要的方向</>;
}

function LiveReadingSections({value}:{value:string}){
  const sections=reportSections(value);
  if(!sections.length)return <article className="report-section open"><p>本次报告尚未成功保存，请从问事记录重新生成。</p></article>;
  return <div className="report-sections continuous">{sections.map((section,index)=><article className="report-section open" key={`${section.title}-${index}`}><header><XiaosuiAvatar mood={index === 0 ? "listening" : index >= sections.length - 2 ? "encouraging" : "explaining"} /><div><small>{String(index+1).padStart(2,"0")}</small><strong>{section.title}</strong></div></header><div className="report-section-content"><p>{section.content}</p></div></article>)}</div>;
}

const reportStoryTitles=[
  "先看见站在选择面前的你",
  "真正牵动你的，不止答案",
  "每张牌都在照见一部分自己",
  "当不同方向同时出现",
  "犹豫背后，是你珍视的东西",
  "让内心与现实重新对齐",
  "先走一步，答案会慢慢清晰",
  "把选择交还给真实的感受",
  "愿你笃定，也允许变化",
] as const;

export function ReadingReport({ report=null, question, cardCount=2, cards=[], onBack, onNext, onShare, onFeedback }: { report?:CardReadingReport|null; question?:string; cardCount?:number; cards?:CardReadingCard[]; onBack?: () => void; onNext: () => void; onShare?: () => void; onFeedback?: () => void }) {
  return <section className="reading-page reading-report"><ReadingHeader/><div className="reading-report-scroll"><p className="eyebrow">YOUR READING · {cardCount} CARDS</p><h1>{readingReportTitle(report?.title,question)}</h1><div className={`card-layout report-card-gallery count-${cardCount}`}>{cards.map(card=><figure key={card.cardCode}><img src={`/cards/satori-default-v1/${CARD_ASSET_BY_CODE[card.cardCode] ?? card.cardCode.toLowerCase().replaceAll("_", "") + ".jpg"}`} alt={`${card.displayName}生命智慧卡牌`}/></figure>)}</div><div className="xiaosui-intro report-xiaosui-intro"><XiaosuiAvatar mood="listening" /><div><strong>小岁说</strong><p>我是小岁，陪你一起读懂这份报告，找到适合自己的下一步。</p></div></div><LiveReadingSections value={report?.report??""}/>{report?.notice&&<div className="task-rule">{report.notice}</div>}{onShare&&<button className="outline-button" type="button" onClick={onShare}>分享五福荟问事报告 <span>↗</span></button>}<button className="primary" onClick={onNext}>完成阅读，返回问事首页 <span>→</span></button></div></section>;
}
