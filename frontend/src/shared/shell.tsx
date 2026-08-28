"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

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
