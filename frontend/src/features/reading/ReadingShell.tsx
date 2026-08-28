"use client";

import { usePathname, useRouter } from "next/navigation";
import { ROUTES } from "@/src/shared/routes";

export function ReadingHeader({ backHref }: { backHref?: string }) {
  const router = useRouter();
  return <header className="reading-header">{backHref?<button className="back-button" type="button" onClick={()=>router.push(backHref)}>←</button>:<span className="brand brand-compact"><span className="brand-mark"><i/></span></span>}<span>问事</span><div className="mini-balance"><i>权益</i></div></header>;
}

export function RouteMainNav() {
  const router = useRouter();
  const pathname = usePathname();
  const tabs = [
    ["今日", ROUTES.home, "◉"],
    ["问事", ROUTES.readings, "◇"],
    ["成长", ROUTES.home, "❧"],
    ["关系", ROUTES.home, "∞"],
    ["我的", ROUTES.my, "○"],
  ] as const;
  return <nav className="main-nav" aria-label="主导航">{tabs.map(([label,href,icon])=><button type="button" key={label} className={pathname.startsWith(href)&&href===ROUTES.readings?"active":pathname===href&&label!=="问事"?"active":""} onClick={()=>router.push(href)}><i>{icon}</i><span>{label}</span></button>)}</nav>;
}
