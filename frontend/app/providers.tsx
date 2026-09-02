"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "@/src/shared/session";
import { AnalyticsProvider } from "@/src/analytics/AnalyticsProvider";

export default function Providers({ children }: { children: ReactNode }) {
  return <AnalyticsProvider><SessionProvider>{children}</SessionProvider></AnalyticsProvider>;
}
