import { routeIdForPath } from "./routes";

type DiagnosticResult = "allowed" | "redirected" | "restored" | "failed" | "cleared";

export function routeDiagnostic(pathname: string, source: "direct" | "navigation" | "guard" | "recovery", result: DiagnosticResult, errorCode?: string) {
  if (process.env.NODE_ENV === "production" && result !== "failed") return;
  console.info("[route]", {
    routeId: routeIdForPath(pathname),
    source,
    result,
    ...(errorCode ? { errorCode } : {}),
  });
}
