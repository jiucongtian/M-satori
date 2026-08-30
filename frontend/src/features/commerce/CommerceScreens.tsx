"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  api,
  type BusinessContext,
  type CheckoutQuote,
  type EntitlementGrant,
  type EntitlementResolution,
  type MembershipPlan,
  type MembershipSubscription,
  type MoneyOrder,
  type PaymentAttempt,
  type Refund,
  type RefundQuote,
  type ServiceOffering,
  type UsageRecord,
} from "@/src/api/client";
import { ProtectedRoute } from "@/src/shared/guards";
import { ROUTES } from "@/src/shared/routes";
import { RouteError, RouteFrame, RouteSkeleton } from "@/src/shared/shell";
import { apiMessage } from "@/src/shared/ui";
import {
  clearPendingCommerceContext,
  getOrCreateReadingContext,
  loadPendingCommerceContext,
  savePendingCommerceContext,
} from "./commerceContext";
import { invokeWechatPay } from "./wechatPay";

const PLAN_NAMES: Record<string, string> = { GLOW: "微光", SERENITY: "清和", FREEDOM: "自在" };
const PLAN_RANKS = ["GLOW", "SERENITY", "FREEDOM"] as const;
const SOURCE_NAMES: Record<string, string> = {
  MEMBERSHIP: "本期会员权益",
  PURCHASE: "已购买权益",
  COMPLIMENTARY_SEED: "智慧种子额度",
};

function readQuery() {
  return new URLSearchParams(window.location.search);
}

function money(amount: number) {
  return `¥${(amount / 100).toFixed(2)}`;
}

function date(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "Asia/Shanghai" }).format(new Date(value));
}

function serviceLabel(value: string) {
  return value === "CARD_READING" ? "抽卡问事" : "今日能量";
}

function kindLabel(value: string) {
  if (value === "MEMBERSHIP_PLAN") return "30 天会员方案";
  if (value === "SERVICE_PACK") return "服务权益包";
  return "单次服务";
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    AWAITING_PAYMENT: "等待支付",
    PAID: "已支付，等待交付",
    FULFILLING: "权益发放中",
    FULFILLED: "已完成",
    FULFILLMENT_FAILED: "交付异常处理中",
    CLOSED: "已关闭",
    REFUNDING: "退款处理中",
    REFUNDED: "已退款",
    SUCCEEDED: "已成功",
    FAILED: "未完成",
    PENDING: "处理中",
    PROCESSING: "处理中",
  };
  return labels[value] ?? value;
}

function CommerceFrame({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return (
    <ProtectedRoute>
      <RouteFrame title={title} label={title} mode="commerce-mode">
        <section className="r11-commerce">
          <header className="commerce-topbar">
            <Link href={ROUTES.my} aria-label="返回我的">‹</Link>
            <span>初见 · FRESH</span>
            <i aria-hidden="true" />
          </header>
          {eyebrow ? <p className="commerce-eyebrow">{eyebrow}</p> : null}
          <h1>{title}</h1>
          {children}
        </section>
      </RouteFrame>
    </ProtectedRoute>
  );
}

function useLoad<T>(loader: () => Promise<T>, dependencies: readonly unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void loader().then((value) => active && setData(value)).catch((reason) => active && setError(apiMessage(reason)));
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  return { data, error, setData };
}

export function ShopScreen() {
  const [returnTo, setReturnTo] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => setReturnTo(readQuery().get("returnTo") === ROUTES.readingPrepare ? ROUTES.readingPrepare : ""), 0); return () => window.clearTimeout(timer); }, []);
  const loader = useCallback(() => Promise.all([api.serviceOfferings(), api.membershipPlans(), api.currentMembership()]), []);
  const { data, error } = useLoad(loader, [loader]);
  if (error) return <RouteError message={error} backHref={ROUTES.my} />;
  if (!data) return <RouteSkeleton label="正在获取最新商品与会员方案…" />;
  const [offerings, plans, membership] = data;
  const services = offerings.filter((item) => item.kind !== "MEMBERSHIP_PLAN");
  return (
    <CommerceFrame title="服务商城" eyebrow="SERVICES AVAILABLE NOW">
      <section className="fresh-store-hero">
        <h2>选择此刻需要的陪伴</h2>
        <p>每一份服务的内容、次数与有效期，都以后端实时信息为准。</p>
      </section>
      <section className="commerce-section fresh-store-section">
        <header><h2>按需选择</h2><small>单独购买，独立使用</small></header>
        {services.length
          ? <div className="offering-list">{services.map((item) => <OfferingCard key={item.offeringId} offering={item} returnTo={returnTo} />)}</div>
          : <div className="commerce-empty">服务正在准备中，请稍后再来看看。</div>}
      </section>
      <section className="commerce-section fresh-membership-section">
        <header><h2>月度陪伴</h2><small>持续使用可以选择会员计划</small></header>
        <Link className="fresh-membership-entry" href={membership?.activePeriod ? ROUTES.myMembership : ROUTES.serviceMembership}>
          <span>和</span>
          <div>
            <small>30 天月度计划</small>
            <strong>{plans.map((plan) => PLAN_NAMES[plan.planCode] ?? plan.name).join(" · ")}</strong>
            <p>{membership?.activePeriod ? `当前正在使用${PLAN_NAMES[membership.activePeriod.planCode]}计划` : "按周期获得今日能量与抽卡问事权益"}</p>
          </div>
          <b>{membership?.activePeriod ? "查看与续费 ›" : "比较方案 ›"}</b>
        </Link>
      </section>
      <div className="fresh-store-boundary"><strong>清楚、独立的服务权益</strong><p>会员与服务包分别记录，使用次数和有效期均以后端权益账本为准。智慧种子只用于活动资格，不折算金额，也不与人民币组合支付。</p></div>
      <Link className="fresh-store-link" href={ROUTES.myBenefits}>查看我的服务权益 <span>→</span></Link>
    </CommerceFrame>
  );
}

function OfferingCard({ offering, returnTo = "" }: { offering: ServiceOffering; returnTo?: string }) {
  const quantity = offering.benefits.reduce((sum, benefit) => sum + benefit.quantity, 0);
  return (
    <Link className="offering-card fresh-offering-card" href={`${ROUTES.shopDetail}?offeringId=${encodeURIComponent(offering.offeringId)}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`}>
      <i>{offering.kind === "SERVICE_PACK" ? "包" : "次"}</i>
      <span><small>{kindLabel(offering.kind)}</small><strong>{offering.name}</strong><p>{quantity} {offering.benefits[0]?.unit === "COUNT" ? "次" : "份"} · 购买后 {offering.validityDays} 天有效</p></span>
      <b>{money(offering.price.amount)}</b>
    </Link>
  );
}

export function ShopDetailScreen() {
  const [offeringId, setOfferingId] = useState("");
  const [returnTo, setReturnTo] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => { const query = readQuery(); setOfferingId(query.get("offeringId") ?? ""); setReturnTo(query.get("returnTo") === ROUTES.readingPrepare ? ROUTES.readingPrepare : ""); setReady(true); }, 0); return () => window.clearTimeout(timer); }, []);
  const loader = useCallback(() => offeringId ? Promise.all([api.serviceOffering(offeringId), api.currentMembership()]) : Promise.resolve(null), [offeringId]);
  const { data, error } = useLoad(loader, [loader, offeringId]);
  if (!ready) return <RouteSkeleton label="正在读取商品详情…" />;
  if (!offeringId) return <RouteError title="商品地址无效" message="没有找到对应商品。" backHref={ROUTES.shop} />;
  if (error) return <RouteError message={error} backHref={ROUTES.shop} />;
  if (!data) return <RouteSkeleton label="正在读取商品详情…" />;
  const [offering, membership] = data;
  const active = membership?.activePeriod ?? null;
  const targetPlanCode = offering.kind === "MEMBERSHIP_PLAN" ? membershipPlanCode(offering.code) : null;
  const currentRank = active ? PLAN_RANKS.indexOf(active.planCode) : -1;
  const targetRank = targetPlanCode ? PLAN_RANKS.indexOf(targetPlanCode) : -1;
  const isRenewal = Boolean(active && targetPlanCode === active.planCode);
  const isUpgrade = Boolean(active && targetRank > currentRank);
  const membershipChangeUnavailable = Boolean(active && targetPlanCode && !isRenewal && !isUpgrade);
  const checkoutHref = isUpgrade && membership
    ? `${ROUTES.checkout}?offeringId=${encodeURIComponent(offering.offeringId)}&previousSubscriptionId=${encodeURIComponent(membership.subscriptionId)}&targetPlanVersionId=${encodeURIComponent(offering.offeringVersionId)}`
    : `${ROUTES.checkout}?offeringId=${encodeURIComponent(offering.offeringId)}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`;
  return (
    <CommerceFrame title={offering.name} eyebrow={kindLabel(offering.kind)}>
      <div className="offering-hero"><span>{serviceLabel(offering.serviceType)}</span><strong>{money(offering.price.amount)}</strong><small>最终金额以服务端报价为准</small></div>
      <section className="detail-facts">
        {offering.benefits.map((benefit, index) => <p key={`${benefit.serviceType}-${index}`}><span>{serviceLabel(benefit.serviceType)}</span><strong>{benefit.quantity} 次</strong></p>)}
        <p><span>有效期</span><strong>{offering.kind === "MEMBERSHIP_PLAN" ? `${offering.validityDays} 天会员周期` : `购买日起 ${offering.validityDays} 天`}</strong></p>
        <p><span>生效方式</span><strong>{isRenewal ? "当前周期结束后按顺序生效" : offering.kind === "MEMBERSHIP_PLAN" ? "支付并安全交付后生效" : "每个权益包分别计时"}</strong></p>
      </section>
      <div className="commerce-safe-note">使用时由系统按照固定规则自动选择会员权益、购买权益包或智慧种子额度，无法手动切换来源。</div>
      {membershipChangeUnavailable
        ? <div className="commerce-safe-note">当前方案不能降级购买；你可以续费当前方案，或升级到更高方案。</div>
        : <Link className="commerce-primary" href={checkoutHref}>{isRenewal ? "续费当前方案" : isUpgrade ? "升级并确认新订单" : "获取服务端报价并确认订单"}</Link>}
    </CommerceFrame>
  );
}

export function CheckoutScreen() {
  const router = useRouter();
  const [params, setParams] = useState<{ offeringId: string; returnTo: string; previousSubscriptionId: string; targetPlanVersionId: string }>({ offeringId: "", returnTo: ROUTES.shop, previousSubscriptionId: "", targetPlanVersionId: "" });
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [upgradeNotice, setUpgradeNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [businessContext, setBusinessContext] = useState<BusinessContext | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const query = readQuery();
      const returnTo = query.get("returnTo") === ROUTES.readingPrepare ? ROUTES.readingPrepare : ROUTES.shop;
      setParams({
        offeringId: query.get("offeringId") ?? "",
        returnTo,
        previousSubscriptionId: query.get("previousSubscriptionId") ?? "",
        targetPlanVersionId: query.get("targetPlanVersionId") ?? "",
      });
      setBusinessContext(returnTo === ROUTES.readingPrepare ? getOrCreateReadingContext() : null);
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!params.offeringId || businessContext === undefined) return;
    let active = true;
    void Promise.all([
      api.createCheckoutQuote(params.offeringId, businessContext),
      params.previousSubscriptionId && params.targetPlanVersionId
        ? api.previewMembershipUpgrade(params.previousSubscriptionId, params.targetPlanVersionId)
        : Promise.resolve(null),
    ]).then(([nextQuote, preview]) => {
      if (!active) return;
      setQuote(nextQuote);
      setUpgradeNotice(preview?.confirmation ?? "");
    }).catch((reason) => active && setError(apiMessage(reason)));
    return () => { active = false; };
  }, [businessContext, params.offeringId, params.previousSubscriptionId, params.targetPlanVersionId]);

  async function submit() {
    if (!quote || busy) return;
    setBusy(true);
    setError("");
    try {
      const order = await api.createMoneyOrder(quote.quoteId);
      if (params.previousSubscriptionId && params.targetPlanVersionId) {
        await api.registerMembershipUpgrade({
          previousSubscriptionId: params.previousSubscriptionId,
          targetPlanVersionId: params.targetPlanVersionId,
          newOrderId: order.orderId,
        });
      }
      const payment = await api.createPaymentAttempt(order.orderId);
      savePendingCommerceContext({
        orderId: order.orderId,
        paymentAttemptId: payment.paymentAttemptId,
        businessContext,
        returnPath: params.returnTo,
        savedAt: new Date().toISOString(),
      });
      if (payment.provider === "WECHAT_PAY") {
        await invokeWechatPay(payment.clientParameters);
      }
      router.push(`${ROUTES.paymentResult}?orderId=${encodeURIComponent(order.orderId)}&paymentAttemptId=${encodeURIComponent(payment.paymentAttemptId)}`);
    } catch (reason) {
      setError(apiMessage(reason));
      setBusy(false);
    }
  }

  if (!ready) return <RouteSkeleton label="正在恢复订单上下文…" />;
  if (!params.offeringId) return <RouteError title="订单地址无效" message="缺少商品信息。" backHref={ROUTES.shop} />;
  if (error && !quote) return <RouteError message={error} backHref={ROUTES.shop} />;
  if (!quote) return <RouteSkeleton label="服务端正在确认价格与购买资格…" />;
  return (
    <CommerceFrame title="确认订单" eyebrow="AUTHORITATIVE QUOTE · 15 MINUTES">
      <div className="checkout-card">
        <small>{kindLabel(quote.offering.kind)}</small><h2>{quote.offering.name}</h2>
        <p><span>服务端报价</span><strong>{money(quote.price.amount)}</strong></p>
        <p><span>报价有效至</span><strong>{new Date(quote.expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</strong></p>
        <p><span>支付方式</span><strong>微信支付</strong></p>
      </div>
      {quote.promotion.eligible && quote.promotion.seedReservationRequired > 0 ? <div className="commerce-safe-note">已满足智慧种子活动资格，将按活动人民币价支付；种子仅用于资格预留。</div> : null}
      {upgradeNotice ? <div className="upgrade-notice"><strong>升级确认</strong><p>{upgradeNotice}</p><p>新方案生效后原方案结束，原方案未使用次数不保留。</p></div> : null}
      {error ? <p className="commerce-error" role="alert">{error}</p> : null}
      <button className="commerce-primary" type="button" disabled={busy} onClick={() => void submit()}>{busy ? "正在创建订单…" : `微信支付 ${money(quote.price.amount)}`}</button>
      <p className="commerce-footnote">支付成功不等于权益已经发放；本页将继续确认交付结果，请勿重复支付。</p>
    </CommerceFrame>
  );
}

export function PaymentResultScreen() {
  const [identity, setIdentity] = useState({ orderId: "", paymentAttemptId: "" });
  const [order, setOrder] = useState<MoneyOrder | null>(null);
  const [payment, setPayment] = useState<PaymentAttempt | null>(null);
  const [error, setError] = useState("");
  const [context, setContext] = useState<ReturnType<typeof loadPendingCommerceContext>>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const query = readQuery();
      const next = { orderId: query.get("orderId") ?? "", paymentAttemptId: query.get("paymentAttemptId") ?? "" };
      setIdentity(next);
      setContext(loadPendingCommerceContext(next.orderId));
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!identity.orderId || !identity.paymentAttemptId) return;
    let active = true;
    let timer = 0;
    const poll = async () => {
      try {
        const [nextOrder, nextPayment] = await Promise.all([api.moneyOrder(identity.orderId), api.paymentAttempt(identity.paymentAttemptId)]);
        if (!active) return;
        setOrder(nextOrder); setPayment(nextPayment); setError("");
        const terminal = ["FULFILLED", "FULFILLMENT_FAILED", "CLOSED", "REFUNDED"].includes(nextOrder.status) || ["FAILED", "CLOSED"].includes(nextPayment.status);
        if (!terminal) timer = window.setTimeout(poll, 1800);
      } catch (reason) {
        if (active) { setError(apiMessage(reason)); timer = window.setTimeout(poll, 3000); }
      }
    };
    void poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [identity]);
  if (!ready) return <RouteSkeleton label="正在恢复支付上下文…" />;
  if (!identity.orderId || !identity.paymentAttemptId) return <RouteError title="支付结果地址无效" message="无法恢复对应订单。" backHref={ROUTES.myOrders} />;
  if (!order || !payment) return <RouteSkeleton label="正在向服务端确认支付与权益发放结果…" />;
  const fulfilled = order.status === "FULFILLED";
  const paid = payment.status === "SUCCEEDED" || ["PAID", "FULFILLING", "FULFILLED"].includes(order.status);
  const failed = ["FAILED", "CLOSED"].includes(payment.status) || order.status === "FULFILLMENT_FAILED";
  const title = fulfilled ? "权益已经到账" : paid ? "支付成功，权益发放中" : failed ? "本次支付未完成" : "正在确认支付结果";
  return (
    <CommerceFrame title={title} eyebrow="PAYMENT ≠ FULFILLMENT">
      <div className={`payment-orbit ${fulfilled ? "success" : failed ? "failed" : "pending"}`}><span>{fulfilled ? "✓" : failed ? "!" : "…"}</span></div>
      <section className="detail-facts">
        <p><span>支付状态</span><strong>{statusLabel(payment.status)}</strong></p>
        <p><span>权益发放</span><strong>{statusLabel(order.fulfillmentStatus)}</strong></p>
        <p><span>订单编号</span><strong>{order.orderNumber}</strong></p>
      </section>
      {paid && !fulfilled ? <div className="commerce-safe-note">已经收到支付结果，请勿重复购买。系统会自动重试权益发放，你也可以稍后在订单中查看。</div> : null}
      {error ? <p className="commerce-error">{error}</p> : null}
      {fulfilled && context?.businessContext ? <Link className="commerce-primary" href={context.returnPath} onClick={clearPendingCommerceContext}>返回刚才的问事流程</Link> : null}
      <Link className={fulfilled && context?.businessContext ? "commerce-secondary" : "commerce-primary"} href={ROUTES.myOrders}>查看订单详情</Link>
    </CommerceFrame>
  );
}

export function BenefitsScreen() {
  const loader = useCallback(() => Promise.all([api.entitlements(), api.usageRecords()]), []);
  const { data, error } = useLoad(loader, [loader]);
  if (error) return <RouteError message={error} backHref={ROUTES.my} />;
  if (!data) return <RouteSkeleton label="正在读取服务权益账本…" />;
  const [grants, records] = data;
  const grouped = grants.reduce<Record<string, EntitlementGrant[]>>((all, grant) => {
    (all[grant.sourceType] ??= []).push(grant); return all;
  }, {});
  return (
    <CommerceFrame title="我的服务权益" eyebrow="SEPARATE GRANTS · APPEND ONLY">
      <p className="commerce-lead">同一权益包不会与其他批次合并或延期；每个批次从购买当天独立按自然日计算。</p>
      {Object.entries(grouped).map(([source, items]) => <section className="benefit-group" key={source}><header><h2>{SOURCE_NAMES[source] ?? source}</h2><span>{items.reduce((sum, item) => sum + item.available, 0)} 次可用</span></header>{items.map((grant) => <GrantCard key={grant.entitlementId} grant={grant} />)}</section>)}
      {grants.length === 0 ? <div className="commerce-empty">还没有可展示的服务权益</div> : null}
      <section className="commerce-section"><header><h2>最近使用记录</h2><small>账本只追加，不直接改余额</small></header><UsageList records={records} /></section>
    </CommerceFrame>
  );
}

function GrantCard({ grant }: { grant: EntitlementGrant }) {
  return <article className="grant-card"><i>{serviceLabel(grant.serviceType).slice(0, 1)}</i><span><strong>{serviceLabel(grant.serviceType)}</strong><small>{date(grant.validFrom)} — {date(grant.expiresAt)}</small><p>{statusLabel(grant.status)} · 已预留 {grant.reserved}</p></span><b>{grant.available}<small> / {grant.total}</small></b></article>;
}

function UsageList({ records }: { records: UsageRecord[] }) {
  if (!records.length) return <div className="commerce-empty">暂无使用记录</div>;
  return <div className="usage-list">{records.slice(0, 20).map((record) => <p key={record.recordId}><i>{record.type}</i><span>{date(record.createdAt)}<small>{record.businessContext.type}</small></span><strong>{record.quantity}</strong></p>)}</div>;
}

export function OrdersScreen() {
  const loader = useCallback(() => api.moneyOrders(), []);
  const { data: orders, error, setData } = useLoad(loader, [loader]);
  async function cancel(orderId: string) {
    const updated = await api.cancelMoneyOrder(orderId);
    setData((orders ?? []).map((item) => item.orderId === orderId ? updated : item));
  }
  if (error) return <RouteError message={error} backHref={ROUTES.my} />;
  if (!orders) return <RouteSkeleton label="正在读取订单…" />;
  return (
    <CommerceFrame title="我的订单" eyebrow="PAYMENT AND DELIVERY ARE SEPARATE">
      <div className="order-list">{orders.map((order) => <article className="order-card" key={order.orderId}><header><small>{order.orderNumber}</small><b>{statusLabel(order.status)}</b></header><h2>{order.offeringSnapshot.name}</h2><p><span>{date(order.createdAt)}</span><strong>{money(order.amount.amount)}</strong></p><footer>{order.status === "AWAITING_PAYMENT" ? <><button onClick={() => void cancel(order.orderId)}>关闭订单</button><Link href={`${ROUTES.checkout}?offeringId=${encodeURIComponent(order.offeringSnapshot.offeringId)}`}>重新获取报价</Link></> : null}{order.status === "FULFILLED" && order.offeringSnapshot.kind !== "MEMBERSHIP_PLAN" ? <Link href={`${ROUTES.myRefunds}?orderId=${encodeURIComponent(order.orderId)}`}>普通退款资格</Link> : null}</footer></article>)}</div>
      {orders.length === 0 ? <div className="commerce-empty">还没有人民币订单</div> : null}
    </CommerceFrame>
  );
}
export function MembershipScreen() {
  const loader = useCallback(async () => {
    const [membership, periods, plans] = await Promise.all([api.currentMembership(), api.membershipPeriods(), api.membershipPlans()]);
    return { membership, periods, plans, loadedAt: Date.now() };
  }, []);
  const { data, error } = useLoad(loader, [loader]);
  if (error) return <RouteError message={error} backHref={ROUTES.my} />;
  if (!data) return <RouteSkeleton label="正在读取会员周期…" />;
  const { membership, periods, plans, loadedAt } = data;
  const active = membership?.activePeriod ?? periods.find((period) => period.status === "ACTIVE") ?? null;
  const currentRank = active ? PLAN_RANKS.indexOf(active.planCode) : -1;
  const remainingDays = active ? Math.max(0, Math.ceil((new Date(active.endsAt).getTime() - loadedAt) / 86_400_000)) : 0;
  return (
    <CommerceFrame title="会员计划" eyebrow="30 DAYS OF GENTLE COMPANY">
      <section className="fresh-membership-hero">
        <h2>按你的节奏<br />选择陪伴深度</h2>
        <p>三档计划均包含今日能量与抽卡问事权益，套餐、价格与周期由服务端实时提供。</p>
        {active ? <div><span>当前计划</span><strong>{PLAN_NAMES[active.planCode]}计划</strong><b>还剩 {remainingDays} 天</b></div> : <div><span>当前计划</span><strong>尚未开通</strong><b>选择后开始</b></div>}
      </section>
      <div className="fresh-plan-note"><strong>续费与升级</strong><p>续费周期在当前周期结束后依次开始；升级会在新方案安全生效后结束原方案，暂不支持降级。</p></div>
      <div className="fresh-membership-plans">{plans.map((plan) => <MembershipAction key={plan.offeringId} plan={plan} membership={membership} activePlanCode={active?.planCode} currentRank={currentRank} />)}</div>
      {periods.length ? <section className="commerce-section fresh-period-section"><header><h2>周期安排</h2><small>以服务端记录为准</small></header><div className="period-list">{periods.map((period) => <p key={period.periodId}><i>{PLAN_NAMES[period.planCode]}</i><span>{date(period.startsAt)} — {date(period.endsAt)}</span><strong>{statusLabel(period.status)}</strong></p>)}</div></section> : null}
      <div className="fresh-store-boundary"><strong>共同规则</strong><p>权益按会员周期记录，未使用次数到期不结转；会员名称表示陪伴方案，不是身份等级。</p></div>
      <nav className="commerce-related-links" aria-label="会员相关服务">
        <Link href={ROUTES.myBenefits}>查看我的权益 <span>→</span></Link>
        <Link href={ROUTES.myOrders}>查看服务订单 <span>→</span></Link>
      </nav>
    </CommerceFrame>
  );
}

function MembershipAction({ plan, membership, activePlanCode, currentRank }: { plan: MembershipPlan; membership: MembershipSubscription | null; activePlanCode?: string; currentRank: number }) {
  const renewal = Boolean(membership && activePlanCode === plan.planCode);
  const rank = PLAN_RANKS.indexOf(plan.planCode);
  const downgrade = Boolean(membership && rank < currentRank);
  const href = membership && !renewal && !downgrade
    ? `${ROUTES.checkout}?offeringId=${encodeURIComponent(plan.offeringId)}&previousSubscriptionId=${encodeURIComponent(membership.subscriptionId)}&targetPlanVersionId=${encodeURIComponent(plan.offeringVersionId)}`
    : `${ROUTES.checkout}?offeringId=${encodeURIComponent(plan.offeringId)}`;
  const benefits = plan.benefits.map((benefit) => `${serviceLabel(benefit.serviceType)} ${benefit.quantity} 次`).join(" ＋ ");
  return <Link className={`fresh-membership-plan ${plan.planCode === "SERENITY" ? "recommended" : ""} ${downgrade ? "disabled" : ""}`} aria-disabled={downgrade} href={downgrade ? ROUTES.myMembership : href}>
    {plan.planCode === "SERENITY" ? <em>推荐</em> : null}
    <span>{plan.planCode === "GLOW" ? "光" : plan.planCode === "SERENITY" ? "和" : "自"}</span>
    <div><small>{PLAN_NAMES[plan.planCode]} · 30 天</small><h2>{plan.name}</h2><p>{benefits}</p><strong>{money(plan.price.amount)}<i> / 30 天</i></strong><b>{downgrade ? "当前不可降级" : renewal ? "续费当前方案 ›" : membership ? "升级方案 ›" : "查看并开通 ›"}</b></div>
  </Link>;
}

function membershipPlanCode(code: string): MembershipPlan["planCode"] | null {
  if (code.includes("membership-glow-")) return "GLOW";
  if (code.includes("membership-serenity-")) return "SERENITY";
  if (code.includes("membership-freedom-")) return "FREEDOM";
  return null;
}

export function RefundsScreen() {
  const [orderId, setOrderId] = useState("");
  const [quote, setQuote] = useState<RefundQuote | null>(null);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => setOrderId(readQuery().get("orderId") ?? ""), 0); void api.refunds().then(setRefunds).catch((reason) => setError(apiMessage(reason))); return () => window.clearTimeout(timer); }, []);
  async function check() { setBusy(true); setError(""); try { setQuote(await api.refundQuote(orderId)); } catch (reason) { setError(apiMessage(reason)); } finally { setBusy(false); } }
  async function request() { if (!quote) return; setBusy(true); setError(""); try { const refund = await api.requestRefund(orderId); setRefunds((items) => [refund, ...items.filter((item) => item.refundId !== refund.refundId)]); setQuote(null); } catch (reason) { setError(apiMessage(reason)); } finally { setBusy(false); } }
  return (
    <CommerceFrame title="普通退款" eyebrow="UNUSED ORDINARY BENEFITS ONLY">
      <p className="commerce-lead">仅支持符合商品快照规则、未使用且没有核销预留的普通订单。会员升级原方案剩余权益不属于退款范围。</p>
      {orderId ? <div className="refund-action"><small>订单</small><strong>{orderId}</strong>{quote ? <><p>服务端报价：{money(quote.amount.amount)}</p><p>有效至：{date(quote.expiresAt)}</p><button disabled={busy} onClick={() => void request()}>确认提交普通退款</button></> : <button disabled={busy} onClick={() => void check()}>{busy ? "正在校验…" : "检查退款资格"}</button>}</div> : <div className="commerce-safe-note">请从“我的订单”选择需要检查的普通订单。</div>}
      {error ? <p className="commerce-error" role="alert">{error}</p> : null}
      <section className="commerce-section"><header><h2>退款记录</h2><small>最终状态以支付渠道事实为准</small></header><div className="refund-list">{refunds.map((refund) => <p key={refund.refundId}><span><strong>{money(refund.amount.amount)}</strong><small>{date(refund.createdAt)}</small></span><b>{statusLabel(refund.status)}</b></p>)}</div>{refunds.length === 0 ? <div className="commerce-empty">暂无普通退款记录</div> : null}</section>
    </CommerceFrame>
  );
}

// Compatibility entry points retained for the R1.1 route tree. The real
// commerce implementation now lives behind the canonical screens above, so
// these routes share the same server-priced, fake-payment-capable flow instead
// of maintaining a second client-side product and order model.
export function ServiceMarketplaceScreen() { return <ShopScreen />; }
export function MembershipPlansScreen() { return <MembershipScreen />; }
export function MembershipDetailScreen() { return <MembershipScreen />; }
export function EnergyPackDetailScreen() { return <ShopScreen />; }
export function ReadingPackDetailScreen() { return <ShopScreen />; }
export function PaymentScreen() { return <CheckoutScreen />; }
export function OrderDetailScreen() { return <OrdersScreen />; }
export function RefundNewScreen() { return <RefundsScreen />; }
export function RefundStatusScreen() { return <RefundsScreen />; }

export function ReadingPrepareScreen() {
  const router = useRouter();
  const [resolution, setResolution] = useState<EntitlementResolution | null>(null);
  const [context, setContext] = useState<BusinessContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => setContext(getOrCreateReadingContext()), 0); return () => window.clearTimeout(timer); }, []);
  useEffect(() => {
    if (!context) return;
    void api.resolveEntitlement("CARD_READING", 1, context, 1).then(setResolution).catch((reason) => setError(apiMessage(reason)));
  }, [context]);
  async function reserve() {
    if (!resolution?.selectedSource) return;
    setBusy(true); setError("");
    try {
      const intent = await api.createConsumptionIntent(resolution.resolutionId);
      await api.startConsumptionIntent(intent.intentId);
      router.push(ROUTES.home);
    } catch (reason) { setError(apiMessage(reason)); setBusy(false); }
  }
  if (error && !resolution) return <RouteError message={error} backHref={ROUTES.home} />;
  if (!resolution) return <RouteSkeleton label="系统正在按固定规则确认可用权益…" />;
  const selected = resolution.selectedSource;
  return (
    <CommerceFrame title={selected ? "本次问事权益已确认" : "需要先获得问事权益"} eyebrow="SYSTEM RULE · NO MANUAL SWITCH">
      {selected ? <><div className="resolution-card"><small>系统自动选择</small><h2>{SOURCE_NAMES[selected.sourceType] ?? selected.sourceType}</h2><p>本次使用 {selected.cost} {selected.unit === "WISDOM_SEED" ? "颗智慧种子" : "次权益"}</p>{selected.expiresAt ? <span>该批次有效至 {date(selected.expiresAt)}</span> : null}</div><div className="commerce-safe-note">扣减顺序与来源由系统固定，页面不提供切换入口。正式抽卡后预留进入运行状态。</div><button className="commerce-primary" disabled={busy} onClick={() => void reserve()}>{busy ? "正在锁定权益…" : "确认后进入抽卡"}</button></> : <><div className="commerce-empty">当前会员权益、已购权益包和可用智慧种子均不足。</div><Link className="commerce-primary" href={`${ROUTES.shop}?returnTo=${encodeURIComponent(ROUTES.readingPrepare)}`}>查看问事权益包</Link></>}
      {error ? <p className="commerce-error">{error}</p> : null}
    </CommerceFrame>
  );
}
