"use client";

import type { CardReadingCard, CardReadingReport } from "@/src/api/client";
import { ReadingHeader } from "./ReadingShell";

export function ReadingStep({ onBack, eyebrow, title, lead, children, action, onNext }: { onBack: () => void; eyebrow: string; title: React.ReactNode; lead?: string; children: React.ReactNode; action?: string; onNext?: () => void }) {
  return <section className="reading-page reading-step"><ReadingHeader onBack={onBack} /><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{lead && <p className="reading-lead">{lead}</p>}<div className="reading-step-body">{children}</div>{action && onNext && <button className="primary" type="button" onClick={onNext}>{action}<span>→</span></button>}</section>;
}

export function ReadingShuffle({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return <section className="reading-page immersive-reading reading-action-page"><ReadingHeader onBack={onBack}/><div className="shuffle-stage"><i/><i/><i/><i/><i/><span>静</span></div><p className="eyebrow">BE WITH YOUR QUESTION</p><h1>先让心安静下来</h1><p>在心里再读一遍你的问题。<br/>准备好时，让牌慢慢展开。</p><button className="primary" onClick={onNext}>我准备好了 <span>→</span></button><small>抽牌结果一经确认将被保存</small></section>;
}

export function ReadingDraw({ cardCount=2, onBack, onNext }: { cardCount?:number; onBack: () => void; onNext: () => void }) {
  return <section className="reading-page draw-page reading-action-page"><ReadingHeader onBack={onBack}/><p className="eyebrow">{cardCount} CARDS DRAWN</p><h1>{cardCount} 张牌已经为你抽出</h1><p className="reading-lead">系统完成公平随机抽取，结果已经保存。</p><div className={`card-layout card-back-layout count-${cardCount}`}>{Array.from({length:cardCount},(_,i)=><figure key={i}><div className="unified-card-back"><i/><span>初</span></div><figcaption>第 {i+1} 张牌</figcaption></figure>)}</div><div className="fair-note"><span>衡</span><p><strong>本次抽取已经固定</strong>刷新或离开页面也不会改变结果。</p></div><button className="primary" onClick={onNext}>翻开这 {cardCount} 张牌 <span>→</span></button></section>;
}

export function ReadingReveal({ cardCount=2, cards=[], onBack, onNext }: { cardCount?:number; cards?:CardReadingCard[]; onBack: () => void; onNext: () => void }) {
  return <ReadingStep onBack={onBack} eyebrow="YOUR CARDS" title="牌已经回应了你的问题" lead={`确认后，这 ${cardCount} 张牌将冻结并用于生成报告。`} action={`确认 ${cardCount} 张卡牌并生成报告`} onNext={onNext}><div className={`card-layout report-card-gallery reveal-card-gallery count-${cardCount}`}>{cards.map(card=><figure key={card.cardCode}><img src={`/cards/satori-default-v1/${card.cardCode}.jpg`} alt={`${card.displayName}生命智慧卡牌`}/></figure>)}</div><div className="frozen-note"><span>封</span><p><strong>本次输入即将冻结</strong>问题、抽牌方式与全部卡牌会被共同保存。</p></div></ReadingStep>;
}

export function ReadingFailure({ onBack, onRetry }: { onBack: () => void; onRetry: () => void }) {
  return <ReadingStep onBack={onBack} eyebrow="PAUSED, NOT LOST" title={<>报告暂时没有长成</>} lead="问题、卡牌和抽取结果都已安全保存，不需要重新抽牌。"><div className="failure-seed"><span>●</span><i/></div><div className="failure-card"><p><strong>本次使用记录已安全保存</strong></p><span><b>01</b>当前结算状态以服务端记录为准</span><span><b>02</b>重新生成不会重复核销</span><span><b>03</b>超过处理时间会按规则自动恢复</span></div><button className="primary" onClick={onRetry}>使用原卡牌重新生成 <span>↻</span></button><button className="text-action" onClick={onBack}>稍后在问事历史继续</button></ReadingStep>;
}

export function ReadingGenerate({ status, cardCount, cards, onBack, onLeave }: { status: string; cardCount: number; cards: CardReadingCard[]; onBack: () => void; onLeave: () => void }) {
  const ready=status==="READY";
  return <section className="reading-page reading-generating reading-action-page"><ReadingHeader onBack={onBack}/><div className={`card-layout generation-card-stage count-${cardCount}`}>{cards.map((card,i)=><figure key={card.cardCode}><img src={`/cards/satori-default-v1/${card.cardCode}.jpg`} alt={`第 ${i+1} 张${card.displayName}生命智慧卡牌`}/></figure>)}</div><div className="generation-list"><span className="done">✓ 已确认问题与 {cardCount} 张卡牌</span><span className="done">✓ 已同步抽牌结果</span><span className="done">✓ 正在读懂这 {cardCount} 张牌</span><span className={ready?"done":"active"}>{ready?"✓":"·"} 正在整理问事报告</span></div><p>{ready?"即将自动打开报告详情":"真实解读通常需要几分钟，可以先离开，完成后会保存在问事记录中"}</p><button className="outline-button" onClick={onLeave}>先离开，稍后查看</button></section>;
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
  return <div className="report-sections continuous">{sections.map((section,index)=><article className="report-section open" key={`${section.title}-${index}`}><header><small>{String(index+1).padStart(2,"0")}</small><strong>{section.title}</strong></header><div className="report-section-content"><p>{section.content}</p></div></article>)}</div>;
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

export function ReadingReport({ report=null, question, cardCount=2, cards=[], onBack, onNext, onShare, onFeedback }: { report?:CardReadingReport|null; question?:string; cardCount?:number; cards?:CardReadingCard[]; onBack: () => void; onNext: () => void; onShare?: () => void; onFeedback?: () => void }) {
  return <section className="reading-page reading-report"><ReadingHeader onBack={onBack}/><div className="reading-report-scroll"><p className="eyebrow">YOUR READING · {cardCount} CARDS</p><h1>{readingReportTitle(report?.title,question)}</h1><div className={`card-layout report-card-gallery count-${cardCount}`}>{cards.map(card=><figure key={card.cardCode}><img src={`/cards/satori-default-v1/${card.cardCode}.jpg`} alt={`${card.displayName}生命智慧卡牌`}/><figcaption><strong>{card.positionLabel}</strong></figcaption></figure>)}</div><LiveReadingSections value={report?.report??""}/>{report?.notice&&<div className="task-rule">{report.notice}</div>}{onFeedback&&<button className="text-action" onClick={onFeedback}>留下本次问事反馈</button>}{onShare&&<button className="outline-button" type="button" onClick={onShare}>分享初见 <span>↗</span></button>}<button className="primary" onClick={onNext}>完成阅读，返回问事首页 <span>→</span></button></div></section>;
}
