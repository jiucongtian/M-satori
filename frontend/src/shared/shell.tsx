"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { PageDebugLabel } from "./ui";

const ROUTE_DEBUG_LABELS: Record<string, string> = {
  "/home": "R1.0 · HOME-01",
  "/daily/report": "R1.0 · DAILY-03",
  "/consent": "R1.0 · AUTH-04",
  "/my": "R1.0 · MY-01 / R1.1 · MY-01",
  "/my/profile": "R1.0 · MY-02 / R1.1 · MY-02",
  "/my/archive": "R1.0 · MY-09 / R1.1 · MY-09",
  "/my/seeds": "R1.0 · MY-03 / R1.1 · SEED-01",
  "/my/benefits": "R1.0 · MY-05 / R1.1 · SEED-02",
  "/my/membership": "R1.1 · SHOP-02",
  "/my/orders": "R1.1 · ORDER-01",
  "/my/orders/demo": "R1.1 · ORDER-02",
  "/my/refunds": "R1.1 · ORDER-03",
  "/my/refunds/new": "R1.1 · ORDER-04",
  "/my/refunds/status": "R1.1 · ORDER-05",
  "/my/reports": "R1.0 · MY-04 / R1.1 · MY-03",
  "/my/support": "R1.0 · MY-08 / R1.1 · MY-08",
  "/my/growth-records": "R1.1 · MY-19",
  "/services": "R1.1 · SHOP-01",
  "/services/membership": "R1.1 · SHOP-02",
  "/services/membership/detail": "R1.1 · SHOP-03",
  "/services/energy-pack": "R1.1 · GOODS-01",
  "/services/reading-pack": "R1.1 · GOODS-02",
  "/shop": "R1.1 · SHOP-01",
  "/shop/detail": "R1.1 · SHOP-04",
  "/checkout": "R1.1 · ORDER-01",
  "/checkout/pay": "R1.1 · ORDER-02",
  "/checkout/result": "R1.1 · ORDER-03",
  "/payment/result": "R1.1 · ORDER-03",
  "/reading/prepare": "R1.1 · READ-03",
};

export function RouteFrame({ title, label, children, mode = "profile-mode" }: { title: string; label: string; children: ReactNode; mode?: string }) {
  const headingRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    document.title = `${title} · 初见 FRESH`;
    headingRef.current?.focus({ preventScroll: true });
  }, [pathname, title]);
  return <main className="stage">
    <section ref={headingRef} tabIndex={-1} className={`phone ${mode}`} aria-label={label}>
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      {ROUTE_DEBUG_LABELS[pathname] ? <PageDebugLabel>{ROUTE_DEBUG_LABELS[pathname]}</PageDebugLabel> : null}
      {children}
    </section>
  </main>;
}

export function RouteSkeleton({ label = "正在加载…" }: { label?: string }) {
  return <RouteFrame title="正在加载" label={label}><div className="legal-state" aria-live="polite" aria-busy="true"><i>芽</i><p>{label}</p></div></RouteFrame>;
}

export function RouteError({ title = "暂时无法打开", message, onRetry, backHref }: { title?: string; message: string; onRetry?: () => void; backHref?: string }) {
  return <RouteFrame title={title} label={title}><div className="legal-state legal-error" role="alert"><i>!</i><h1>{title}</h1><p>{message}</p>{onRetry && <button type="button" onClick={onRetry}>重新加载</button>}{backHref && <a className="outline-button" href={backHref}>返回</a>}</div></RouteFrame>;
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return <div className="legal-state" role="status"><i>芽</i><h1>{title}</h1><p>{message}</p></div>;
}
