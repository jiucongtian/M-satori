"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type EntitlementResolution } from "@/src/api/client";
import { apiMessage } from "@/src/shared/ui";
import { ROUTES } from "@/src/shared/routes";
import { ReadingHeader } from "./ReadingShell";

export function ReadingPaymentScreen({ cardCount, question, requestKey, onBack, onNext }: {
  cardCount: number; question?: string; requestKey: string; onBack: () => void; onNext: () => void;
}) {
  const [resolution, setResolution] = useState<EntitlementResolution | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api.resolveEntitlement("CARD_READING", 1, { type: "CARD_READING_INTENT", id: requestKey }, cardCount)
      .then(value => { if (active) setResolution(value); })
      .catch(reason => { if (active) setError(apiMessage(reason)); });
    return () => { active = false; };
  }, [cardCount, requestKey]);
  const source = resolution?.selectedSource;
  return <section className="reading-page reading-step">
    <ReadingHeader onBack={onBack}/><h1>确认这次问事</h1>
    <div className="reading-order"><h2>{cardCount} 张卡牌</h2><p>{question}</p>
      <div><span>抽牌方式</span><strong>系统公平随机抽取</strong></div>
      {source && <div className="cost"><span>本次预留</span><strong>{source.cost} {source.unit === "WISDOM_SEED" ? "颗智慧种子" : "次问事权益"}</strong></div>}
    </div>
    {error ? <p role="alert">{error}</p> : !resolution ? <p>正在确认可用权益…</p> : source ?
      <button className="primary" onClick={onNext}>确认权益，开始抽牌 <span>→</span></button> :
      <><p>当前可用权益不足，请先获取问事服务。</p><Link className="primary" href={`/shop?returnTo=${encodeURIComponent(ROUTES.readingPrepare)}`}>查看问事服务</Link></>}
    <p className="refund-note">抽牌前由系统再次校验并预留；只有形成有效问事报告才会核销，生成失败会恢复预留权益。</p>
  </section>;
}
