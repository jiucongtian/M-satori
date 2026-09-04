"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type CardReading } from "@/src/api/client";
import { ProtectedRoute } from "@/src/shared/guards";
import { ROUTES } from "@/src/shared/routes";
import { RouteFrame } from "@/src/shared/shell";
import { apiMessage, PageDebugLabel } from "@/src/shared/ui";
import { ReadingHeader } from "./ReadingShell";

const FILTERS = ["全部", "事业", "情感", "个人状态"];
const STATUS: Record<string, string> = {
  DRAWN: "等待生成",
  GENERATING: "生成中",
  READY: "已完成",
  FAILED: "待重试",
};

export default function ReadingHistoryScreen() {
  const router = useRouter();
  const [items, setItems] = useState<CardReading[]>([]);
  const [filter, setFilter] = useState("全部");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (nextCursor?: string) => {
    setLoading(true);
    setError("");
    try {
      const page = await api.cardReadings(nextCursor);
      setItems((current) =>
        nextCursor
          ? [
              ...current,
              ...page.items.filter(
                (item) =>
                  !current.some(
                    (existing) => existing.readingId === item.readingId,
                  ),
              ),
            ]
          : page.items,
      );
      setCursor(page.nextCursor);
    } catch (reason) {
      setError(apiMessage(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("pageshow", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);
  useEffect(() => {
    if (
      !items.some(
        (item) => item.status === "GENERATING" || item.status === "DRAWN",
      )
    )
      return;
    const timer = window.setInterval(() => void load(), 3_000);
    return () => window.clearInterval(timer);
  }, [items, load]);

  async function retry(readingId: string) {
    setError("");
    try {
      const updated = await api.retryCardReading(readingId);
      setItems((current) =>
        current.map((item) => (item.readingId === readingId ? updated : item)),
      );
      openReading(updated);
    } catch (reason) {
      setError(apiMessage(reason));
    }
  }

  function openReading(item: CardReading) {
    const readingId = encodeURIComponent(item.readingId);
    if (item.status === "READY") router.push(`/readings/report?readingId=${readingId}`);
    else if (item.status === "DRAWN") router.push(`/readings/reveal?cards=${item.cardCount}&readingId=${readingId}&from=${encodeURIComponent(ROUTES.readingHistory)}`);
    else if (item.status === "GENERATING") router.push(`/readings/generating?cards=${item.cardCount}&readingId=${readingId}&from=${encodeURIComponent(ROUTES.readingHistory)}`);
  }

  const visible =
    filter === "全部"
      ? items
      : items.filter((item) => item.category === filter);
  return (
    <ProtectedRoute>
      <RouteFrame title="问事记录" label="问事记录">
        <section className="reading-page reading-history">
          <PageDebugLabel>R1.1 · READ-19</PageDebugLabel>
          <ReadingHeader backHref={ROUTES.readings} />
          <p className="eyebrow">MY READINGS</p>
          <h1>我的问事记录</h1>
          <p className="reading-lead">
            问题、卡牌与报告会一起保存，生成中和失败待处理的任务也会在这里恢复。
          </p>
          <div className="history-filters">
            {FILTERS.map((value) => (
              <button
                type="button"
                className={filter === value ? "active" : ""}
                onClick={() => setFilter(value)}
                key={value}
              >
                {value}
              </button>
            ))}
          </div>
          {error ? (
            <p className="commerce-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="history-list">
            {visible.map((item) => (
              <button
                type="button"
                key={item.readingId}
                onClick={() => openReading(item)}
              >
                <small>
                  {formatDate(item.createdAt)} · {item.category} ·{" "}
                  {item.cardCount} 张
                </small>
                <h2>{item.question}</h2>
                <p>
                  {item.cards.map((card, index) => (
                    <span key={card.cardCode}>
                      {index > 0 ? <i>×</i> : null}
                      {card.displayName}
                    </span>
                  ))}
                  <b>{STATUS[item.status] ?? "处理中"}</b>
                </p>
                {item.status === "FAILED" ? (
                  <span
                    className="history-retry"
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      void retry(item.readingId);
                    }}
                  >
                    使用原卡牌重试
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {!loading && !visible.length ? (
            <div className="commerce-empty">这里还没有问事记录</div>
          ) : null}
          {cursor ? (
            <button
              className="outline-button"
              type="button"
              disabled={loading}
              onClick={() => void load(cursor)}
            >
              {loading ? "正在加载…" : "加载更多"}
            </button>
          ) : null}
          <button
            className="primary"
            type="button"
            onClick={() => router.push(ROUTES.readingNew)}
          >
            开始新的问事 <span>→</span>
          </button>
        </section>
      </RouteFrame>
    </ProtectedRoute>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}
