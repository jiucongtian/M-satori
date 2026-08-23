import { ROUTES, safeNextPath } from "@/src/shared/routes";
export function routeAfterAuthentication(nextAction: string | undefined, requestedNext?: string | null) { if (requestedNext) return safeNextPath(requestedNext); return !nextAction || nextAction === "CREATE_PROFILE" ? ROUTES.profileCreate : ROUTES.home; }
