"use client";

import { useRouter } from "next/navigation";
import { MySupport } from "@/src/features/legacy/LegacyProfileFlow";
import { ProtectedRoute } from "@/src/shared/guards";
import { RouteFrame } from "@/src/shared/shell";

export function MySupportScreen() {
  const router = useRouter();
  return <ProtectedRoute><RouteFrame title="联系我们" label="联系我们"><MySupport onBack={() => router.back()} /></RouteFrame></ProtectedRoute>;
}
