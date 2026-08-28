"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiError, CONSENT_REQUIRED_EVENT, type Me } from "@/src/api/client";
import { clearAllFlowDrafts } from "@/src/shared/storage";
import { consentPath, ROUTES, safeNextPath } from "./routes";
import { routeDiagnostic } from "./diagnostics";
import { clearQueryCache } from "./query";

export type SessionStatus = "unknown" | "anonymous" | "authenticated" | "consent-required";

type SessionContextValue = {
  status: SessionStatus;
  me: Me | null;
  resolve: () => Promise<SessionStatus>;
  markAuthenticated: (me: Me) => void;
  markConsentRequired: () => void;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("unknown");
  const [me, setMe] = useState<Me | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const resolve = useCallback(async (): Promise<SessionStatus> => {
    try {
      const restored = await api.refresh();
      if (!restored) {
        setMe(null);
        setStatus("anonymous");
        return "anonymous";
      }
      const current = await api.me();
      setMe(current);
      setStatus("authenticated");
      routeDiagnostic(pathname, "recovery", "restored");
      return "authenticated";
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONSENT_REQUIRED") {
        setStatus("consent-required");
        return "consent-required";
      }
      setMe(null);
      setStatus("anonymous");
      return "anonymous";
    }
  }, [pathname]);

  useEffect(() => {
    const timer = window.setTimeout(() => void resolve(), 0);
    return () => window.clearTimeout(timer);
  }, [resolve]);

  useEffect(() => {
    const handleConsentRequired = () => {
      setStatus("consent-required");
      const next = safeNextPath(`${window.location.pathname}${window.location.search}`);
      routeDiagnostic(pathname, "guard", "redirected", "CONSENT_REQUIRED");
      router.replace(consentPath(next));
    };
    window.addEventListener(CONSENT_REQUIRED_EVENT, handleConsentRequired);
    return () => window.removeEventListener(CONSENT_REQUIRED_EVENT, handleConsentRequired);
  }, [pathname, router]);

  const value = useMemo<SessionContextValue>(() => ({
    status,
    me,
    resolve,
    markAuthenticated(current) { setMe(current); setStatus("authenticated"); },
    markConsentRequired() { setStatus("consent-required"); },
    async logout() {
      try { await api.logout(); } finally {
        api.setAccessToken(null);
        clearQueryCache();
        clearAllFlowDrafts();
        setMe(null);
        setStatus("anonymous");
        routeDiagnostic(pathname, "guard", "cleared");
        router.replace(ROUTES.welcome);
      }
    },
  }), [me, pathname, resolve, router, status]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
