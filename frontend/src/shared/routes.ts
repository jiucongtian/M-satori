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
  legal: "/legal",
} as const;

export type RouteId = keyof typeof ROUTES;
export type AppPath = (typeof ROUTES)[RouteId];

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
]);

const SAFE_NEXT_PATHS = new Set<AppPath>([...PROTECTED_PATHS]);
const SENSITIVE_QUERY_KEYS = new Set([
  "phone", "verificationCode", "code", "accessToken", "refreshToken",
  "birthDate", "birthTime", "birthday", "question", "prompt",
]);
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/;
const DOCUMENT_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export function isIsoDate(value: string | null): value is string {
  if (!value || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isDocumentId(value: string | null): value is string {
  return Boolean(value && DOCUMENT_ID.test(value));
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
    if (parsed.pathname !== ROUTES.dailyReport || key !== "date") return fallback;
  }
  if (parsed.pathname === ROUTES.dailyReport && parsed.search && !isIsoDate(parsed.searchParams.get("date"))) return fallback;
  return `${parsed.pathname}${parsed.search}`;
}

export function loginPath(next: string) {
  return `${ROUTES.login}?next=${encodeURIComponent(safeNextPath(next))}`;
}

export function consentPath(next: string) {
  return `${ROUTES.consent}?next=${encodeURIComponent(safeNextPath(next))}`;
}

export function routeIdForPath(pathname: string): RouteId | "unknown" {
  const entry = Object.entries(ROUTES).find(([, path]) => path === pathname);
  return (entry?.[0] as RouteId | undefined) ?? "unknown";
}
