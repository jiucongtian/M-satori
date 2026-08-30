import type { BusinessContext } from "@/src/api/client";

const CONTEXT_KEY = "satori:commerce:payment-context";
const READING_CONTEXT_KEY = "satori:reading:business-context";

export type PendingCommerceContext = {
  orderId: string;
  paymentAttemptId: string;
  businessContext: BusinessContext | null;
  returnPath: string;
  savedAt: string;
};

const SAFE_RETURN_PATHS = new Set(["/home", "/reading/prepare", "/my/orders", "/shop"]);

export function savePendingCommerceContext(value: PendingCommerceContext) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(CONTEXT_KEY, JSON.stringify(value));
}

export function loadPendingCommerceContext(orderId?: string): PendingCommerceContext | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(CONTEXT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingCommerceContext;
    if (!parsed.orderId || !parsed.paymentAttemptId || (orderId && parsed.orderId !== orderId)) return null;
    if (!SAFE_RETURN_PATHS.has(parsed.returnPath)) parsed.returnPath = "/home";
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingCommerceContext() {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(CONTEXT_KEY);
}

export function getOrCreateReadingContext(): BusinessContext {
  if (typeof window === "undefined") return { type: "CARD_READING_INTENT", id: "pending" };
  const existing = window.sessionStorage.getItem(READING_CONTEXT_KEY);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) {
    return { type: "CARD_READING_INTENT", id: existing };
  }
  const id = crypto.randomUUID();
  window.sessionStorage.setItem(READING_CONTEXT_KEY, id);
  return { type: "CARD_READING_INTENT", id };
}

