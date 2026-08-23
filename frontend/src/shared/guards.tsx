"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "./session";
import { consentPath, loginPath } from "./routes";
import { RouteSkeleton } from "./shell";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") router.replace(loginPath(pathname));
    if (status === "consent-required") router.replace(consentPath(pathname));
  }, [pathname, router, status]);

  if (status !== "authenticated") return <RouteSkeleton label="正在安全恢复账号…" />;
  return children;
}
