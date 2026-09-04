import type { ReactNode } from "react";
import Link from "next/link";
import { ApiError, type Bootstrap } from "@/src/api/client";

// R1.1 development and test builds show page codes by default. Production must
// explicitly set NEXT_PUBLIC_SHOW_PAGE_LABELS=false when the release is tagged.
const showPageDebugLabels = process.env.NEXT_PUBLIC_SHOW_PAGE_LABELS !== "false";
export function PageDebugLabel({ children }: { children: string }) { return showPageDebugLabels ? <span className="screen-id" aria-hidden="true">{children}</span> : null; }
export function Brand({ compact = false }: { compact?: boolean }) { return <Link className={`brand ${compact ? "brand-compact" : ""}`} href="/" aria-label="初见首页"><span className="brand-mark" aria-hidden="true"><i /></span><span><strong>初见</strong><small>FRESH</small></span></Link>; }
export function apiMessage(error: unknown) { return error instanceof ApiError ? `${error.message}${error.requestId ? `（请求 ${error.requestId}）` : ""}` : "网络连接失败，请稍后重试"; }
export function requiredConsentAcceptances(bootstrap: Bootstrap) { return bootstrap.requiredLegalDocuments.filter((document) => document.required).map(({ documentId, version }) => ({ documentId, version })); }
export function legalHref(bootstrap: Bootstrap | null, type: "TERMS_OF_SERVICE" | "PRIVACY_POLICY" | "AI_CONTENT_NOTICE") { const document = bootstrap?.requiredLegalDocuments.find((item) => item.type === type); return document ? `/legal?documentId=${encodeURIComponent(document.documentId)}` : "#"; }
export function LiveMessage({ children, success = false }: { children: ReactNode; success?: boolean }) { return <div className={`form-message ${success ? "success" : ""}`} aria-live="polite">{children}</div>; }
