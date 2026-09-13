"use client";

import { usePathname, useRouter } from "next/navigation";
import { AppBottomNav, type AppTab } from "@/src/shared/AppBottomNav";
import { ROUTES } from "@/src/shared/routes";
import { BackButton } from "@/src/components/FreshPrimitives";
import { Brand } from "@/src/shared/ui";

export function ReadingHeader({ backHref, onBack }: { backHref?: string; onBack?: () => void }) {
  const router = useRouter();
  return <header className="reading-header">{onBack||backHref?<BackButton onClick={onBack??(()=>router.push(backHref!))}/>:<Brand compact />}<span>问事</span><div className="reading-header-spacer" aria-hidden="true" /></header>;
}

export function RouteMainNav() {
  const router = useRouter();
  const pathname = usePathname();
  const active: AppTab = pathname.startsWith(ROUTES.readings) ? "问事" : "今日";
  const navigate = (tab: AppTab) => {
    if (tab === "问事") router.push(ROUTES.readings);
    else if (tab === "我的") router.push(ROUTES.my);
    else if (tab === "今日") router.push(ROUTES.home);
    else router.push(`${ROUTES.home}?tab=${tab === "关系" ? "relationship" : "growth"}&source=tabbar`);
  };
  return <AppBottomNav active={active} onNavigate={navigate}/>;
}
