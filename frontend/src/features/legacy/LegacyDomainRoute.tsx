"use client";
import { useRouter } from "next/navigation";
import { ProtectedRoute } from "@/src/shared/guards";
import { RouteFrame } from "@/src/shared/shell";
import { ROUTES } from "@/src/shared/routes";
import { useSession } from "@/src/shared/session";
import { LegacyProfileFlow } from "./LegacyProfileFlow";
import "./legacy.css";

export function LegacyDomainRoute({ title, label, initialStep, dailyDate }: { title: string; label: string; initialStep: number; dailyDate?: string }) {
  const router = useRouter(); const { logout } = useSession();
  return <ProtectedRoute><RouteFrame title={title} label={label}><LegacyProfileFlow initialStep={initialStep} dailyDate={dailyDate} onExit={() => router.replace(ROUTES.home)} onLogout={logout} onNavigateRoute={(path, replace) => replace ? router.replace(path) : router.push(path)} /></RouteFrame></ProtectedRoute>;
}

