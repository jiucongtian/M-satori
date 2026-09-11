"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type DailyInsight, type HomeOverview, type WisdomSeedAccount } from "@/src/api/client";
import { ProtectedRoute } from "@/src/shared/guards";
import { dailyReportReturnPath, isIsoDate, ROUTES, type AppPath } from "@/src/shared/routes";
import { RouteError, RouteFrame, RouteSkeleton } from "@/src/shared/shell";
import { apiMessage } from "@/src/shared/ui";

type Mood = "listening" | "explaining" | "encouraging";
const labels = { listening: "小岁倾听", explaining: "小岁讲解", encouraging: "小岁鼓励" };

const MOCK_DEEP_SECTIONS = [
  { code: "energy", title: "精力状态", tip: "头脑逻辑清晰，但精神内耗会放大，容易明明没干重活却觉得疲惫。", source: "秋的禀赋善于梳理剖析，遇到繁杂信息时，大脑会不自觉反复推演，消耗心神。", actions: ["每工作45分钟短暂停顿放空。", "晚间减少复盘思虑，不要反复回想白天细节。"] },
  { code: "relationship", title: "人际相处", tip: "沟通追求客观有理，容易执着对错，无意间让对话变得紧绷。", source: "先天习惯看见漏洞与不足，容易把审视模式带到人际关系。", actions: ["沟通优先讲目标，少纠结细节对错。", "感受到气氛紧张，主动暂停对话。"] },
  { code: "decision", title: "事务抉择", tip: "非常适合梳理、归档、复盘；面对全新重大冒险，容易过度权衡，难以快速下决断。", source: "秋能量擅长校验风险，对于未知事项本能会放大隐患。", actions: ["优先处理收尾、整理类工作。", "重大决定不要在当日仓促定夺。", "若必须决策，只抓核心两点，不追求面面俱到。"] },
  { code: "awareness", title: "内心觉察", tip: "容易拿高标准要求自己，一件小事没做好就否定整体。", source: "先天对完成度有内在期待，容易把局部瑕疵等同于全盘失败。", actions: ["区分“这件事没做好”和“我不够好”。", "写下一件今天做得尚可的小事，平衡自我评判。"] },
  { code: "pace", title: "行事节奏", tip: "不适合全天高频对外输出，持续社交、谈判会快速耗损能量；独处沉淀反而恢复更快。", source: "该禀赋的能量恢复，来自向内收敛沉淀，而非向外不断交互。", actions: ["把重要对外事务集中一小段时间处理。", "留出独处时段，不必强迫自己时刻活跃。"] },
] as const;

export function XiaosuiAvatar({ mood }: { mood: Mood }) {
  return <span role="img" aria-label={labels[mood]} className={`xiaosui-avatar xiaosui-avatar--${mood}`} />;
}

export function DeepDailyReport({ insight, energyLevel, heavenCard, balance, onBack, onNext, onShare }: {
  insight: DailyInsight; energyLevel?: "高" | "中" | "低"; heavenCard?: string; balance: number | null; onBack: () => void; onNext: () => void; onShare: () => void;
}) {
  const content = insight.content;
  const sections = content?.sections?.length === 5 ? content.sections : MOCK_DEEP_SECTIONS;
  return <section className="daily-page daily-report xiaosui-report">
    <header className="daily-header">
      <button type="button" className="back-button" onClick={onBack} aria-label="返回">←</button>
      <strong>每日指引</strong><span />
    </header>
    <div className="report-scroll">
      <p className="eyebrow">{insight.localDate} · 禀赋：{content?.endowment || "秋"}｜深度指引{heavenCard ? ` · ${heavenCard}` : ""}</p>
      <h1>你的今日能量指引</h1>
      <div className="xiaosui-energy"><div><strong>{energyLevel || content?.resonance || "中"}</strong><small>今日能量</small></div><div><small>智慧种子</small><strong>{balance ?? "—"} 颗</strong></div></div>
      <div className="xiaosui-intro"><XiaosuiAvatar mood="listening" /><div>
        <strong>小岁说</strong>
        <p>{content?.xiaosui?.intro || "我是小岁，陪你读懂今天，找到适合自己的下一步。"}</p>
      </div></div>
      <p className="xiaosui-keyword">今日关键词：<strong>{content?.theme || "先整理节奏，再回应变化"}</strong></p>
      <p className="xiaosui-resonance">今日共振：<strong>{energyLevel || content?.resonance || "中"}</strong></p>
      {sections.map((section, index) => <article className="xiaosui-section" key={section.code}>
        <header><XiaosuiAvatar mood={index === 3 ? "listening" : index === 4 ? "encouraging" : "explaining"} />
          <div><small>{String(index + 1).padStart(2, "0")}</small><h2>{section.title}</h2></div>
        </header>
        <div className="section-block"><b>今日提示</b><p>{section.tip}</p></div>
        <div className="section-block"><b>模式溯源</b><p>{section.source}</p></div>
        <div className="section-block"><b>行动参考</b><ol>{section.actions.map((action, actionIndex) => <li key={actionIndex}>{action}</li>)}</ol></div>
      </article>)}
      <div className="xiaosui-intro"><XiaosuiAvatar mood="encouraging" /><p>不必一次做到全部，先选一件适合你的小事。</p></div>
      <p className="ai-content-notice"><b>AI 生成内容</b>{content?.notice || "内容用于自我观察与成长参考。"}不构成医疗、投资、法律建议或对未来结果的保证。</p>
      <button className="outline-button" type="button" onClick={onShare}>分享今日指引 <span>↗</span></button>
      <button className="primary" type="button" onClick={onNext}>收下今天的行动 <span>→</span></button>
    </div>
  </section>;
}

export default function DailyReportScreen() {
  const [date, setDate] = useState<string | null>(null);
  const [returnPath, setReturnPath] = useState<AppPath>(ROUTES.home);
  const [ready, setReady] = useState(false);
  const [insight, setInsight] = useState<DailyInsight | null>(null);
  const [home, setHome] = useState<HomeOverview | null>(null);
  const [seeds, setSeeds] = useState<WisdomSeedAccount | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams(window.location.search);
      setDate(query.get("date"));
      setReturnPath(dailyReportReturnPath(query.get("from")));
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!isIsoDate(date)) return;
    let active = true;
    void Promise.all([api.dailyInsight(date), api.home(), api.seedAccount()]).then(([value, overview, account]) => { if (active) { setInsight(value); setHome(overview); setSeeds(account); } })
      .catch(reason => { if (active) setError(apiMessage(reason)); });
    return () => { active = false; };
  }, [date]);
  if (!ready) return <RouteSkeleton />;
  if (!isIsoDate(date)) return <RouteError title="报告地址无效" message="没有找到可恢复的每日指引。" backHref={returnPath} />;
  if (error) return <RouteError title="报告暂时无法打开" message={error} backHref={returnPath} />;
  if (!insight) return <RouteSkeleton label="正在恢复每日报告…" />;
  if (insight.status !== "READY") return <RouteError title="报告尚未就绪" message={insight.status === "FAILED" ? "本次生成未完成，请返回每日指引重试。" : "报告仍在生成，请稍后查看。"} backHref={returnPath} />;
  const actions = {
    onBack: () => router.replace(returnPath),
    onNext: () => router.replace(ROUTES.home),
    onShare: () => router.push(`/share/generating?type=daily&date=${encodeURIComponent(date)}`),
  };
  const energy = home?.dailyEnergySummary.data?.date === date ? home.dailyEnergySummary.data : undefined;
  return <ProtectedRoute><RouteFrame title="每日报告" label="每日报告"><div className="profile-flow">
    <DeepDailyReport insight={insight} energyLevel={energy?.energyLevel} heavenCard={energy?.heavenCard} balance={seeds?.available ?? null} {...actions} />
  </div></RouteFrame></ProtectedRoute>;
}
