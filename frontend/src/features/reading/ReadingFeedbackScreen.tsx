"use client";

import { useState } from "react";
import { api } from "@/src/api/client";
import { apiMessage } from "@/src/shared/ui";

const choices = [
  ["CLEARER", "更清楚了"], ["INSPIRED", "有些启发"],
  ["NEEDS_TIME", "还需要时间"], ["NOT_HELPFUL", "没有帮助"],
] as const;
type Feeling = typeof choices[number][0];

export function ReadingFeedbackScreen({ readingId, onBack, onDone }: { readingId: string; onBack: () => void; onDone: () => void }) {
  const [feeling, setFeeling] = useState<Feeling | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!feeling || busy) return;
    setBusy(true); setError("");
    try { await api.cardReadingFeedback(readingId, feeling); onDone(); }
    catch (reason) { setError(apiMessage(reason)); }
    finally { setBusy(false); }
  }
  return <section className="reading-page reading-feedback">
    <button className="text-action" onClick={onBack}>返回报告</button><h1>这次问事带给你什么？</h1>
    <div className="feedback-question"><div>{choices.map(([value, label]) => <button key={value} aria-pressed={feeling === value} className={feeling === value ? "active" : ""} onClick={() => setFeeling(value)}>{label}</button>)}</div></div>
    {error && <p role="alert">{error}</p>}
    <button className="primary" disabled={!feeling || busy} onClick={() => void submit()}>{busy ? "正在保存…" : "保存反馈，回到问事首页"}</button>
    <button className="text-action" onClick={onDone}>暂不反馈</button>
  </section>;
}
