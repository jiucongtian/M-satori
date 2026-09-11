"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type DailyInsight } from "@/src/api/client";
import { DailyReport } from "@/src/features/legacy/LegacyProfileFlow";
import { ProtectedRoute } from "@/src/shared/guards";
import { dailyReportReturnPath, isIsoDate, ROUTES, type AppPath } from "@/src/shared/routes";
import { RouteError, RouteFrame, RouteSkeleton } from "@/src/shared/shell";
import { apiMessage } from "@/src/shared/ui";

type Mood = "listening" | "explaining" | "encouraging";
const labels = { listening: "小岁倾听", explaining: "小岁讲解", encouraging: "小岁鼓励" };

export function XiaosuiAvatar({ mood }: { mood: Mood }) {
  return <span role="img" aria-label={labels[mood]} className={`xiaosui-avatar xiaosui-avatar--${mood}`} />;
}

export function DeepDailyReport({ insight, onBack, onNext, onShare }: {
  insight: DailyInsight; onBack: () => void; onNext: () => void; onShare: () => void;
}) {
  const content = insight.content;
  return <section className="daily-page daily-report xiaosui-report">
    <header className="daily-header">
      <button type="button" className="back-button" onClick={onBack} aria-label="返回">←</button>
      <strong>每日指引</strong><span />
    </header>
    <div className="report-scroll">
      <p className="eyebrow">{insight.localDate}{content?.endowment ? ` · 禀赋：${content.endowment}` : ""}｜深度指引</p>
      <h1>小岁陪你读懂今天</h1>
      <div className="xiaosui-intro"><XiaosuiAvatar mood="listening" /><div>
        <strong>小岁说</strong>
        <p>{content?.xiaosui?.intro || "我是小岁，陪你读懂今天，找到适合自己的下一步。"}</p>
      </div></div>
      <p className="xiaosui-resonance">今日共振：<strong>{content?.resonance || "暂未提供"}</strong></p>
      {content?.sections?.map((section, index) => <article className="xiaosui-section" key={section.code}>
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
    void api.dailyInsight(date).then(value => { if (active) setInsight(value); })
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
  const deep = insight.content?.sections;
  const validDeep = Array.isArray(deep) && deep.length === 5 && deep.every(section =>
    section && typeof section.code === "string" && typeof section.title === "string" &&
    typeof section.tip === "string" && typeof section.source === "string" &&
    Array.isArray(section.actions) && section.actions.length >= 2 && section.actions.length <= 3 &&
    section.actions.every(action => typeof action === "string"));
  return <ProtectedRoute><RouteFrame title="每日报告" label="每日报告"><div className="profile-flow">
    {validDeep ? <DeepDailyReport insight={insight} {...actions} /> :
      <DailyReport name="你" insight={insight} balance={null} {...actions} />}
  </div></RouteFrame></ProtectedRoute>;
}
