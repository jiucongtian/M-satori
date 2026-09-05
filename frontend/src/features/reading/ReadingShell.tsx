"use client";

import { usePathname, useRouter } from "next/navigation";
import { AppBottomNav, type AppTab } from "@/src/shared/AppBottomNav";
import { ROUTES } from "@/src/shared/routes";
import { useWisdomSeedBalance } from "./useWisdomSeedBalance";
import { BackButton } from "@/src/components/FreshPrimitives";

export function ReadingHeader({ backHref, onBack }: { backHref?: string; onBack?: () => void }) {
  const router = useRouter();
  const balance = useWisdomSeedBalance();
  return <header className="reading-header">{onBack||backHref?<BackButton onClick={onBack??(()=>router.push(backHref!))}/>:<span className="brand brand-compact"><span className="brand-mark"><i/></span></span>}<span>问事</span><div className="mini-balance" aria-label={`智慧种子 ${balance ?? "正在同步"}`}><i>●</i>{balance ?? "—"}</div></header>;
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
