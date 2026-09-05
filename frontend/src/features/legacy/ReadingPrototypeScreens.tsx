"use client";

// 仅供历史视觉原型预览，不作为业务完成或结算依据。
import { useEffect, useState } from "react";
import { ReadingHeader } from "../reading/ReadingShell";
import { ReadingStep, ReadingGenerate as ReadingGenerationView, ReadingReport as ReadingReportView } from "../reading/ReadingScreens";
const showPageDebugLabels = process.env.NEXT_PUBLIC_SHOW_PAGE_LABELS !== "false";

export function ReadingQuestion({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [question, setQuestion] = useState("我该如何面对现在的工作变化？");
  const types = ["事业", "情感", "财富", "健康", "选择", "个人状态", "其他"];
  const [type, setType] = useState("事业");
  return <section className="reading-page question-input"><ReadingHeader onBack={onBack} /><p className="eyebrow">YOUR QUESTION</p><h1>此刻，你最想问什么？</h1><p className="reading-lead">尽量问与你自己有关、当下能够行动的问题。</p><div className="question-box"><textarea value={question} maxLength={120} onChange={e => setQuestion(e.target.value)} aria-label="输入想问的问题" /><div><small>{question.length} / 120</small><button type="button">清空</button></div></div><div className="question-guide"><strong>更容易获得启发的问法</strong><p>“我可以如何……”　“我需要看见什么……”</p><small>避免只问“会不会”“是不是”，也不替第三方窥探隐私。</small></div><div className="question-types"><small>这更接近哪个方向？</small><div>{types.map(item => <button type="button" key={item} className={type === item ? "active" : ""} onClick={() => setType(item)}>{item}</button>)}</div></div><button className="primary" type="button" onClick={onNext} disabled={question.trim().length < 6}>看看我真正想问的是什么 <span>→</span></button></section>;
}

export function ReadingConfirm({ onBack, onNext, onSafety }: { onBack: () => void; onNext: () => void; onSafety: () => void }) {
  const [focus, setFocus] = useState("找到适合自己的应对方式");
  return <section className="reading-page reading-confirm"><ReadingHeader onBack={onBack} /><p className="eyebrow">MAKE IT CLEAR</p><h1>让问题更靠近<br />你真正关心的事</h1><div className="original-question"><small>你刚才写下</small><p>“我该如何面对现在的工作变化？”</p></div><div className="clarified-question"><span>整理后的问题</span><h2>面对当前的工作变化，我可以如何看清自己的位置，并找到更适合的应对方式？</h2><button type="button">修改问题</button></div><div className="focus-choice"><small>这次最想获得什么？</small>{["看清变化背后的意义", "找到适合自己的应对方式", "理解内心真正的顾虑"].map(item => <button type="button" className={focus === item ? "active" : ""} key={item} onClick={() => setFocus(item)}><i>{focus === item ? "✓" : ""}</i>{item}</button>)}</div><div className="reading-boundary"><i>心</i><p><strong>牌提供理解，不替你做决定</strong>最后的选择仍然属于你。</p></div><button className="primary" type="button" onClick={onNext}>确认这个问题 <span>→</span></button>{showPageDebugLabels&&<button className="prototype-failure" type="button" onClick={onSafety}>调试：查看安全替代路径</button>}</section>;
}

export function ReadingSafety({ onBack, onContinue, onRewrite }: { onBack: () => void; onContinue: () => void; onRewrite: () => void }) {
  return <section className="reading-page reading-safety"><ReadingHeader onBack={onBack} /><div className="safety-lantern" aria-hidden="true"><i /><span>护</span></div><p className="eyebrow">A SAFER WAY TO ASK</p><h1>这个问题需要换一种<br />更安全的问法</h1><p className="reading-lead">卡牌不能代替医疗诊断、投资决策、法律意见，也不适合预测他人的隐私与意图。</p><div className="unsafe-example"><small>原来的问法</small><p>“我是不是得了严重的病？”</p></div><div className="safe-alternative"><small>可以换成</small><h2>“面对最近的身体不适，我可以怎样照顾好自己的情绪，并为就医做好准备？”</h2><span>建议：身体不适请及时咨询专业医生</span></div><button className="primary" type="button" onClick={onContinue}>使用建议问法继续 <span>→</span></button><button className="outline-button" type="button" onClick={onRewrite}>重新写一个问题</button><button className="text-action" type="button">查看紧急帮助与专业资源</button></section>;
}

export function ReadingSpread({ onBack, onNext }: { onBack: () => void; onNext: (cardCount:number) => void }) {
  const [count, setCount] = useState(2);
  const spreads = [{key:"single",count:1,label:"一张",title:"聚焦一份提醒",note:"适合问题清楚，希望获得一个明确方向"},{key:"double",count:2,label:"两张",title:"看见两面的关系",note:"适合两个选择、双方关系或内在拉扯"},{key:"multi",count:3,label:"多张",title:"展开完整脉络",note:"适合信息较多、需要综合理解的问题"}];
  const isMulti=count>=3;
  return <section className="reading-page spread-select"><ReadingHeader onBack={onBack} /><p className="eyebrow">CHOOSE CARD COUNT</p><h1>这次想怎样抽牌？</h1><p className="reading-lead">选择一张、两张或多张，后续页面会保持相同数量。</p><div className="spread-list">{spreads.map(item => {const active=item.key==="multi"?isMulti:count===item.count;return <button type="button" key={item.key} className={active?"active":""} onClick={() => setCount(item.count)}><div className={`spread-cards count-${Math.min(item.count,3)}`}><i /><i /><i /></div><span><small>{item.label}卡牌</small><strong>{item.title}</strong><p>{item.note}</p></span><b>{active?"✓":""}</b><em>{item.key==="multi"?"3—5":item.count} ●</em></button>})}</div>{isMulti&&<div className="multi-count-picker"><span><strong>多张模式</strong><small>选择本次实际抽取数量</small></span><div><button type="button" onClick={()=>setCount(Math.max(3,count-1))}>−</button><b>{count} 张</b><button type="button" onClick={()=>setCount(Math.min(5,count+1))}>＋</button></div></div>}<button className="primary" type="button" onClick={()=>onNext(count)}>就这样，抽取 {count} 张牌 <span>→</span></button><p className="next-hint">现在不会消耗智慧种子，下一步确认后再开始抽牌</p></section>;
}

export function ReadingConfig({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [mode,setMode]=useState("外部变化 / 内心应对");
  return <ReadingStep onBack={onBack} eyebrow="TWO POSITIONS" title={<>为两张牌<br />确定各自的位置</>} lead="每张牌只回答一个角色，关系才会清晰。" action="确认位置配置" onNext={onNext}><div className="position-preview"><article><b>1</b><span>外部变化</span><small>我正在面对什么</small></article><i>↔</i><article><b>2</b><span>内心应对</span><small>我可以如何回应</small></article></div><div className="config-options">{["外部变化 / 内心应对","现状 / 下一步","担心的事 / 真正的需要"].map(x=><button className={mode===x?"active":""} onClick={()=>setMode(x)} key={x}><i>{mode===x?"✓":""}</i>{x}</button>)}</div><div className="rule-note">两张牌的位置确认后，将和抽到的牌一起冻结，不会在报告生成时悄悄交换。</div></ReadingStep>;
}

export function ReadingPayment({ cardCount=2, question, category="事业", positions, onBack, onNext }: { cardCount?:number; question?:string; category?:string; positions?:string[]; onBack: () => void; onNext: () => void }) {
  return <ReadingStep onBack={onBack} eyebrow="CONFIRM YOUR READING" title="确认这次问事" lead="无论抽取几张牌，一次完整问事统一使用 1 次问事权益。" action="使用 1 次问事权益，开始抽牌" onNext={onNext}><div className="reading-order"><small>本次内容</small><h2>{category} · {cardCount} 张卡牌</h2><p>{question||"面对当前的问题，我可以如何看见更适合自己的方向？"}</p>{positions?.length&&<div><span>牌位含义</span><strong>{positions.join(" · ")}</strong></div>}<div><span>卡牌体系</span><strong>默认生命智慧卡牌</strong></div><div><span>抽牌方式</span><strong>系统公平随机抽取</strong></div><div className="cost"><span>本次使用</span><strong>问事权益 1 次</strong></div></div><div className="balance-change"><span>原型预览：不展示或扣除真实权益</span></div><p className="refund-note">只有形成有效问事报告才会核销；生成失败不会消耗权益，也不会重复提交。</p></ReadingStep>;
}

export function ReadingFeedback({ onBack, onHome, onShare }: { onBack: () => void; onHome: () => void; onShare: () => void }) {
  const [feeling,setFeeling]=useState("更清楚了");
  return <section className="reading-page reading-feedback"><ReadingHeader onBack={onBack}/><div className="feedback-bloom"><span>✓</span><i/><i/></div><p className="eyebrow">READING COMPLETE</p><h1>这次问事已经完成</h1><p className="reading-lead">你的问题、卡牌与报告都已保存。</p><div className="feedback-question"><strong>现在的你，感觉怎么样？</strong><div>{["更清楚了","有些启发","还需要时间","没有帮助"].map(x=><button className={feeling===x?"active":""} onClick={()=>setFeeling(x)} key={x}>{x}</button>)}</div></div><div className="feedback-summary"><span>问事报告 <b>已保存</b></span><span>问事记录 <b>已归档</b></span><span>本次使用 <b>已记录</b></span></div><button className="primary" onClick={onHome}>完成，回到问事首页 <span>→</span></button><button className="text-action" onClick={onShare}>生成问事分享卡</button></section>;
}

export function ReadingInsufficient({ onBack, onRecharge, onUseSingle }: { onBack: () => void; onRecharge: () => void; onUseSingle: () => void }) {
  return <section className="reading-page reading-empty"><ReadingHeader onBack={onBack}/><div className="empty-seed"><span>●</span><i/></div><p className="eyebrow">NEED MORE SUPPORT</p><h1>当前可用额度不足</h1><p className="reading-lead">问题与配置已经替你保存，补充可用服务后可以从这里继续。</p><button className="primary" onClick={onRecharge}>查看可用服务 <span>→</span></button><button className="outline-button" onClick={onUseSingle}>调整本次问事</button><button className="text-action" onClick={onBack}>暂时保存，稍后继续</button></section>;
}

export function ReadingMessageReturn({ onBack, onOpen }: { onBack: () => void; onOpen: () => void }) {
  return <section className="reading-page reading-message"><ReadingHeader onBack={onBack}/><div className="message-bloom"><span>✓</span><i/><i/></div><p className="eyebrow">YOUR READING IS READY</p><h1>你的问事报告<br/>已经长好了</h1><p className="reading-lead">刚才离开没有影响生成。问题、两张卡牌和完整报告都已安全保存。</p><div className="message-card"><small>刚刚 · 问事报告</small><h2>面对当前的工作变化，我可以如何找到更适合的应对方式？</h2><p><span>辛巳</span><i>×</i><span>甲子</span><b>已完成</b></p></div><button className="primary" onClick={onOpen}>打开问事报告 <span>→</span></button><button className="text-action" onClick={onBack}>稍后从问事记录查看</button></section>;
}

export function ReadingShareOptions({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [privacy,setPrivacy]=useState("隐藏问题");
  return <section className="reading-page reading-share"><ReadingHeader onBack={onBack}/><p className="eyebrow">SHARE THE INSIGHT</p><h1>把这一刻的看见<br/>分享出去</h1><p className="reading-lead">默认保护你的原始问题，只分享卡牌与对你有力量的一句话。</p><div className="reading-share-preview"><small>今日问事 · 双卡</small><div><span>辛巳</span><i>×</i><span>甲子</span></div><h2>变化不是在催你离开<br/>而是在邀请你重新选择</h2><footer>初见 · FRESH</footer></div><div className="share-privacy"><strong>分享时展示</strong>{["隐藏问题","展示问题主题","展示完整问题"].map(x=><button className={privacy===x?"active":""} onClick={()=>setPrivacy(x)} key={x}><i>{privacy===x?"✓":""}</i>{x}</button>)}</div><button className="primary" onClick={onNext}>生成分享图片 <span>→</span></button></section>;
}

export function ReadingShareGenerating({ onBack, onSuccess, onFailure }: { onBack: () => void; onSuccess: () => void; onFailure: () => void }) {
  return <section className="reading-page reading-share-generating"><ReadingHeader onBack={onBack}/><div className="share-card-grow"><i/><i/><span>问</span></div><p className="eyebrow">GROWING A SHARE CARD</p><h1>正在把这次看见<br/>长成一张图片</h1><div className="render-progress"><i/><span>整理卡牌、金句与隐私信息</span></div>{showPageDebugLabels&&<><button className="text-action" onClick={onSuccess}>调试：查看生成完成 →</button><button className="prototype-failure" onClick={onFailure}>调试：查看生成失败</button></>}</section>;
}

export function ReadingShareSuccess({ onBack, onHome }: { onBack: () => void; onHome: () => void }) {
  const [saved,setSaved]=useState(false);
  return <section className="reading-page reading-share-success"><ReadingHeader onBack={onBack}/><div className="success-bloom"><i/><i/><i/><span>✓</span></div><p className="eyebrow">READY TO SHARE</p><h1>{saved?"分享图片已保存":"问事分享图片已经长好"}</h1><div className="reading-share-preview ready"><small>今日问事 · 双卡</small><div><span>辛巳</span><i>×</i><span>甲子</span></div><h2>变化不是在催你离开<br/>而是在邀请你重新选择</h2><footer>初见 · FRESH</footer></div><div className="ready-actions"><button onClick={()=>setSaved(true)}><i>↓</i><span><strong>保存图片</strong><small>{saved?"已保存到相册":"高清分享图"}</small></span></button><button><i>↗</i><span><strong>系统分享</strong><small>打开手机分享菜单</small></span></button></div><button className="primary" onClick={onHome}>完成，回到问事首页 <span>→</span></button></section>;
}

export function ReadingNetworkError({ onBack, onRetry }: { onBack: () => void; onRetry: () => void }) {
  return <section className="reading-page reading-network"><ReadingHeader onBack={onBack}/><div className="resting-seed"><i/><span>连</span></div><p className="eyebrow">CONNECTION PAUSED</p><h1>网络暂时走散了</h1><p className="reading-lead">你的问题、抽到的牌与种子状态都已保存，不会重复扣除，也不会重新抽牌。</p><div className="failure-card"><p><strong>恢复连接后可以继续</strong></p><span><b>01</b>保留原问题与原卡牌</span><span><b>02</b>不会再次消耗智慧种子</span><span><b>03</b>也可以稍后从问事记录继续</span></div><button className="primary" onClick={onRetry}>重新连接并继续 <span>↻</span></button><button className="text-action" onClick={onBack}>回到问事首页</button></section>;
}

export function ReadingGenerate({ onBack, onSuccess, onFailure, onLeave, onNetworkError }: { onBack: () => void; onSuccess: () => void; onFailure: () => void; onLeave: () => void; onNetworkError: () => void }) {
  useEffect(()=>{const timer=window.setTimeout(onSuccess,1650);return()=>window.clearTimeout(timer)},[onSuccess]);
  return <><ReadingGenerationView status="GENERATING" cardCount={2} cards={[]} onBack={onBack} onLeave={onLeave}/><button onClick={onFailure}>原型：查看生成失败状态</button><button onClick={onNetworkError}>原型：查看网络中断状态</button></>;
}

export function ReadingReport({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return <ReadingReportView onBack={onBack} onNext={onNext} report={null} question="原型报告预览"/>;
}
