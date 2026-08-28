"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "@/src/shared/session";

export default function Providers({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
