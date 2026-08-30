import type { components } from "../api/contracts/generated";

export const ROUTES = {
  welcome: "/",
  login: "/login",
  consent: "/consent",
  home: "/home",
  profileCreate: "/profile/create",
  daily: "/daily",
  dailyReport: "/daily/report",
  readings: "/readings",
  readingNew: "/readings/new",
  readingHistory: "/readings/history",
  services: "/services",
  serviceMembership: "/services/membership",
  serviceMembershipDetail: "/services/membership/detail",
  serviceEnergyPack: "/services/energy-pack",
  serviceReadingPack: "/services/reading-pack",
  checkout: "/checkout",
  checkoutPay: "/checkout/pay",
  checkoutResult: "/checkout/result",
  my: "/my",
  myProfile: "/my/profile",
  mySeeds: "/my/seeds",
  myReports: "/my/reports",
  myGrowthRecords: "/my/growth-records",
  myArchive: "/my/archive",
  mySupport: "/my/support",
  myBenefits: "/my/benefits",
  myOrders: "/my/orders",
  myOrderDemo: "/my/orders/demo",
  refundNew: "/my/refunds/new",
  refundStatus: "/my/refunds/status",
  legal: "/legal",
  shop: "/shop",
  shopDetail: "/shop/detail",
  paymentResult: "/payment/result",
  readingPrepare: "/reading/prepare",
  myMembership: "/my/membership",
  myRefunds: "/my/refunds",
} as const;

export type RouteId = keyof typeof ROUTES;
export type AppPath = (typeof ROUTES)[RouteId];
export type DailyReportSource = "my-reports" | "growth-records";
export type AuthNextAction = components["schemas"]["NextAction"];

const AUTHENTICATED_ENTRY_PATHS = {
  ACCEPT_CONSENTS: ROUTES.consent,
  CREATE_PROFILE: ROUTES.profileCreate,
  CONFIRM_PROFILE: ROUTES.profileCreate,
  CLAIM_REGISTRATION_REWARD: ROUTES.profileCreate,
  CREATE_TODAY_DAILY_INSIGHT: ROUTES.home,
  VIEW_HOME: ROUTES.home,
} satisfies Record<AuthNextAction, AppPath>;

export const PUBLIC_PATHS = new Set<AppPath>([ROUTES.welcome, ROUTES.login, ROUTES.legal]);
export const PROTECTED_PATHS = new Set<AppPath>([
  ROUTES.home,
  ROUTES.profileCreate,
  ROUTES.daily,
  ROUTES.dailyReport,
  ROUTES.readings,
  ROUTES.readingNew,
  ROUTES.readingHistory,
  ROUTES.services,
  ROUTES.serviceMembership,
  ROUTES.serviceMembershipDetail,
  ROUTES.serviceEnergyPack,
  ROUTES.serviceReadingPack,
  ROUTES.checkout,
  ROUTES.checkoutPay,
  ROUTES.checkoutResult,
  ROUTES.my,
  ROUTES.myProfile,
  ROUTES.mySeeds,
  ROUTES.myReports,
  ROUTES.myGrowthRecords,
  ROUTES.myArchive,
  ROUTES.mySupport,
  ROUTES.shop,
  ROUTES.shopDetail,
  ROUTES.paymentResult,
  ROUTES.readingPrepare,
  ROUTES.myBenefits,
  ROUTES.myOrders,
  ROUTES.myMembership,
  ROUTES.myRefunds,
  ROUTES.myOrderDemo,
  ROUTES.refundNew,
  ROUTES.refundStatus,
]);

const SAFE_NEXT_PATHS = new Set<AppPath>([...PROTECTED_PATHS]);
const SENSITIVE_QUERY_KEYS = new Set([
  "phone", "verificationCode", "code", "accessToken", "refreshToken",
  "birthDate", "birthTime", "birthday", "question", "prompt",
]);
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/;
const DOCUMENT_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const COMMERCE_QUERY_KEYS: Partial<Record<AppPath, ReadonlySet<string>>> = {
  [ROUTES.shop]: new Set(["returnTo", "from"]),
  [ROUTES.shopDetail]: new Set(["offeringId", "returnTo"]),
  [ROUTES.checkout]: new Set(["offeringId", "returnTo", "previousSubscriptionId", "targetPlanVersionId"]),
  [ROUTES.paymentResult]: new Set(["orderId", "paymentAttemptId"]),
  [ROUTES.myBenefits]: new Set(["from"]),
  [ROUTES.myMembership]: new Set(["from"]),
  [ROUTES.serviceMembership]: new Set(["from"]),
  [ROUTES.serviceMembershipDetail]: new Set(["from"]),
  [ROUTES.myOrders]: new Set(["orderId", "kind", "from"]),
  [ROUTES.myRefunds]: new Set(["orderId"]),
};
const RETURN_PATHS = new Set<AppPath>([
  ROUTES.home,
  ROUTES.readings,
  ROUTES.readingHistory,
  ROUTES.services,
  ROUTES.serviceMembership,
  ROUTES.my,
  ROUTES.myBenefits,
  ROUTES.myGrowthRecords,
  ROUTES.myOrders,
  ROUTES.myMembership,
  ROUTES.shop,
  ROUTES.readingPrepare,
]);
const COMMERCE_RETURN_PATHS = new Set<string>([...RETURN_PATHS]);

export function isIsoDate(value: string | null): value is string {
  if (!value || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isDocumentId(value: string | null): value is string {
  return Boolean(value && DOCUMENT_ID.test(value));
}

export function dailyReportPath(localDate: string, source?: DailyReportSource): string {
  const query = new URLSearchParams({ date: localDate });
  if (source) query.set("from", source);
  return `${ROUTES.dailyReport}?${query.toString()}`;
}

export function dailyReportReturnPath(source: string | null | undefined): AppPath {
  if (source === "my-reports") return ROUTES.myReports;
  if (source === "growth-records") return ROUTES.myGrowthRecords;
  return ROUTES.home;
}

export function safeReturnPath(value: string | null | undefined, fallback: AppPath): AppPath {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  let parsed: URL;
  try {
    parsed = new URL(value, "https://fresh.local");
  } catch {
    return fallback;
  }
  if (parsed.origin !== "https://fresh.local" || parsed.search || parsed.hash) return fallback;
  return RETURN_PATHS.has(parsed.pathname as AppPath) ? parsed.pathname as AppPath : fallback;
}

export function withReturnPath(destination: string, from: AppPath): string {
  const parsed = new URL(destination, "https://fresh.local");
  parsed.searchParams.set("from", safeReturnPath(from, ROUTES.my));
  return `${parsed.pathname}${parsed.search}`;
}

export function safeNextPath(value: string | null | undefined, fallback: AppPath = ROUTES.home): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  let parsed: URL;
  try {
    parsed = new URL(value, "https://fresh.local");
  } catch {
    return fallback;
  }
  if (parsed.origin !== "https://fresh.local" || !SAFE_NEXT_PATHS.has(parsed.pathname as AppPath)) return fallback;
  for (const key of parsed.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEYS.has(key)) return fallback;
    const commerceKeys = COMMERCE_QUERY_KEYS[parsed.pathname as AppPath];
    if (parsed.pathname !== ROUTES.dailyReport && !commerceKeys?.has(key)) return fallback;
    if (parsed.pathname === ROUTES.dailyReport && !["date", "from"].includes(key)) return fallback;
  }
  if (parsed.pathname === ROUTES.dailyReport && parsed.search) {
    if (!isIsoDate(parsed.searchParams.get("date"))) return fallback;
    const source = parsed.searchParams.get("from");
    if (source && source !== "my-reports" && source !== "growth-records") return fallback;
  }
  for (const [key, value] of parsed.searchParams) {
    const commerceKeys = COMMERCE_QUERY_KEYS[parsed.pathname as AppPath];
    if (commerceKeys && (key === "returnTo" || key === "from") && !COMMERCE_RETURN_PATHS.has(value)) return fallback;
    if (key !== "returnTo" && key !== "from" && parsed.pathname !== ROUTES.dailyReport && !isDocumentId(value)) return fallback;
  }
  return `${parsed.pathname}${parsed.search}`;
}

export function authenticatedEntryPath(nextAction: AuthNextAction): AppPath {
  return AUTHENTICATED_ENTRY_PATHS[nextAction];
}

export function consentCompletionPath(nextAction: AuthNextAction, requestedNext?: string | null): string {
  const requiredPath = authenticatedEntryPath(nextAction);
  if (requiredPath !== ROUTES.home) return requiredPath;
  return safeNextPath(requestedNext, requiredPath);
}

export function consentPath(next: string) {
  return `${ROUTES.consent}?next=${encodeURIComponent(safeNextPath(next))}`;
}

export function routeIdForPath(pathname: string): RouteId | "unknown" {
  const entry = Object.entries(ROUTES).find(([, path]) => path === pathname);
  return (entry?.[0] as RouteId | undefined) ?? "unknown";
}
