import type { components } from "../api/contracts/generated";

export const ROUTES = {
  welcome: "/",
  login: "/login",
  consent: "/consent",
  home: "/home",
  profileCreate: "/profile/create",
  daily: "/daily",
  dailyReport: "/daily/report",
  my: "/my",
  myProfile: "/my/profile",
  mySeeds: "/my/seeds",
  myReports: "/my/reports",
  myArchive: "/my/archive",
  mySupport: "/my/support",
  legal: "/legal",
  shop: "/shop",
  shopDetail: "/shop/detail",
  checkout: "/checkout",
  paymentResult: "/payment/result",
  readingPrepare: "/reading/prepare",
  myBenefits: "/my/benefits",
  myOrders: "/my/orders",
  myMembership: "/my/membership",
  myRefunds: "/my/refunds",
} as const;

export type RouteId = keyof typeof ROUTES;
export type AppPath = (typeof ROUTES)[RouteId];
export type DailyReportSource = "my-reports";
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
  ROUTES.my,
  ROUTES.myProfile,
  ROUTES.mySeeds,
  ROUTES.myReports,
  ROUTES.myArchive,
  ROUTES.mySupport,
  ROUTES.shop,
  ROUTES.shopDetail,
  ROUTES.checkout,
  ROUTES.paymentResult,
  ROUTES.readingPrepare,
  ROUTES.myBenefits,
  ROUTES.myOrders,
  ROUTES.myMembership,
  ROUTES.myRefunds,
]);

const SAFE_NEXT_PATHS = new Set<AppPath>([...PROTECTED_PATHS]);
const SENSITIVE_QUERY_KEYS = new Set([
  "phone", "verificationCode", "code", "accessToken", "refreshToken",
  "birthDate", "birthTime", "birthday", "question", "prompt",
]);
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/;
const DOCUMENT_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const COMMERCE_QUERY_KEYS: Partial<Record<AppPath, ReadonlySet<string>>> = {
  [ROUTES.shop]: new Set(["returnTo"]),
  [ROUTES.shopDetail]: new Set(["offeringId", "returnTo"]),
  [ROUTES.checkout]: new Set(["offeringId", "returnTo", "previousSubscriptionId", "targetPlanVersionId"]),
  [ROUTES.paymentResult]: new Set(["orderId", "paymentAttemptId"]),
  [ROUTES.myOrders]: new Set(["orderId"]),
  [ROUTES.myRefunds]: new Set(["orderId"]),
};
const COMMERCE_RETURN_PATHS = new Set<string>([ROUTES.home, ROUTES.readingPrepare, ROUTES.shop]);

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
  return source === "my-reports" ? ROUTES.myReports : ROUTES.home;
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
    if (source && source !== "my-reports") return fallback;
  }
  for (const [key, value] of parsed.searchParams) {
    if (key === "returnTo" && !COMMERCE_RETURN_PATHS.has(value)) return fallback;
    if (key !== "returnTo" && parsed.pathname !== ROUTES.dailyReport && !isDocumentId(value)) return fallback;
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
