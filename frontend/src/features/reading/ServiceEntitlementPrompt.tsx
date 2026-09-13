"use client";
import { ROUTES } from "@/src/shared/routes";
import { useRouter } from "next/navigation";
export function ServiceEntitlementPrompt({kind}:{kind:"reading"|"daily"}){const router=useRouter();const label=kind==="daily"?"今日指引":"抽卡问事";return <div className="service-prompt-backdrop" role="presentation"><section className="service-prompt" role="dialog" aria-modal="true"><div className="service-prompt-avatar">小岁</div><p className="eyebrow">SERVICE BENEFIT</p><h2>先准备好一次{label}</h2><p>当前没有可用的服务次数。去服务商城选择合适的服务包，回来后就可以继续。</p><button className="primary" type="button" onClick={()=>router.push(ROUTES.shop)}>知道了，去服务商城 <span>→</span></button></section></div>}
