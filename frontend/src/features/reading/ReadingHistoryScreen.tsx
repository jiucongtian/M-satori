"use client";

import { useRouter } from "next/navigation";
import { ProtectedRoute } from "@/src/shared/guards";
import { ROUTES } from "@/src/shared/routes";
import { RouteFrame } from "@/src/shared/shell";
import { PageDebugLabel } from "@/src/shared/ui";
import { ReadingHeader } from "./ReadingShell";

export default function ReadingHistoryScreen(){const router=useRouter();return <ProtectedRoute><RouteFrame title="问事记录" label="问事记录"><section className="reading-page reading-history"><PageDebugLabel>R1.1 · READ-19</PageDebugLabel><ReadingHeader backHref={ROUTES.readings}/><p className="eyebrow">MY READINGS</p><h1>我的问事记录</h1><p className="reading-lead">问题、卡牌与报告会一起保存，生成中和失败待处理的任务也会在这里恢复。</p><div className="history-filters">{["全部","事业","情感","个人状态"].map((x,i)=><button className={i===0?"active":""} key={x}>{x}</button>)}</div><div className="history-list"><button onClick={()=>router.push("/readings/report")}><small>昨天 · 事业 · 双卡</small><h2>我该如何面对现在的工作变化？</h2><p><span>辛巳</span><i>×</i><span>甲子</span><b>已完成</b></p></button><button onClick={()=>router.push("/readings/generating")}><small>今天 · 个人状态 · 三卡</small><h2>最近的疲惫正在提醒我什么？</h2><p><span>生成中</span><b>约 2 分钟</b></p></button><button onClick={()=>router.push("/readings/failure")}><small>08月02日 · 情感 · 单卡</small><h2>这段关系里，我真正需要看见什么？</h2><p><span>乙卯</span><b>待重试</b></p></button></div><button className="primary" type="button" onClick={()=>router.push(ROUTES.readingNew)}>开始新的问事 <span>→</span></button></section></RouteFrame></ProtectedRoute>;}
