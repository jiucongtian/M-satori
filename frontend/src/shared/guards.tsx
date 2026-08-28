"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "./session";
import { authenticatedEntryPath, consentPath, ROUTES } from "./routes";
import { RouteSkeleton } from "./shell";
import { PROTOTYPE_MODE } from "./prototype";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status, me } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (PROTOTYPE_MODE) return;
    if (status === "anonymous") router.replace(ROUTES.login);
    if (status === "consent-required") router.replace(consentPath(pathname));
    if (status === "authenticated" && me) {
      const requiredPath = authenticatedEntryPath(me.nextAction);
      if (requiredPath !== ROUTES.home && pathname !== requiredPath) router.replace(requiredPath);
    }
  }, [me, pathname, router, status]);

  if (PROTOTYPE_MODE) return children;

  if (status !== "authenticated") return <RouteSkeleton label="正在安全恢复账号…" />;
  if (me) {
    const requiredPath = authenticatedEntryPath(me.nextAction);
    if (requiredPath !== ROUTES.home && pathname !== requiredPath) return <RouteSkeleton label="正在继续未完成的注册步骤…" />;
  }
  return children;
}
