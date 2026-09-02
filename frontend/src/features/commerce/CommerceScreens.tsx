"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { ROUTES, safeReturnPath, withReturnPath, type AppPath } from "@/src/shared/routes";
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
  MEMBERSHIP: "会员计划内可用次数",
  PURCHASE: "单独购买的服务次数",
  COMPLIMENTARY_SEED: "赠送的智慧种子额度",
  PROMOTION: "活动赠送的服务次数",
  COMPENSATION: "官方补发的服务次数",
  MIGRATION: "历史服务次数",
};

const CONTEXT_NAMES: Record<string, string> = {
  DAILY_INSIGHT: "今日能量",
  CARD_READING_INTENT: "抽卡问事",
  MEMBERSHIP_RENEWAL: "会员续费",
  MEMBERSHIP_UPGRADE: "会员升级",
  ENTITLEMENT_GRANT: "服务次数发放",
  ENTITLEMENT_SOURCE: "服务次数批次",
  OPERATOR_ADJUSTMENT: "官方调整",
  MEMBERSHIP: "会员计划",
  PURCHASE: "单独购买",
  COMPLIMENTARY_SEED: "智慧种子赠送",
  PROMOTION: "活动赠送",
  COMPENSATION: "官方补发",
  MIGRATION: "历史记录迁移",
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

function productName(value: string) {
  return value.replace(/\s*·\s*R1\.1体验版/g, "").trim();
}

function orderOffering(order: MoneyOrder) {
  const snapshot = order.offeringSnapshot as unknown as Record<string, unknown>;
  const publicKind = typeof snapshot.kind === "string" ? snapshot.kind : null;
  const legacyKind = snapshot.offeringKind;
  return {
    offeringId: String(snapshot.offeringId ?? ""),
    name: productName(String(snapshot.name ?? snapshot.displayName ?? "服务订单")),
    kind: publicKind ?? (legacyKind === "PACKAGE" ? "SERVICE_PACK" : legacyKind === "MEMBERSHIP" ? "MEMBERSHIP_PLAN" : "SINGLE_SERVICE"),
  };
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    AWAITING_PAYMENT: "等待支付",
    PAID: "已支付，等待到账",
    FULFILLING: "权益发放中",
    FULFILLED: "已完成",
    FULFILLMENT_FAILED: "服务到账异常处理中",
    CLOSED: "已关闭",
    REFUNDING: "退款处理中",
    REFUNDED: "已退款",
    SUCCEEDED: "已成功",
    FAILED: "未完成",
    PENDING: "处理中",
    PROCESSING: "处理中",
    CREATED: "待处理",
    NOT_STARTED: "尚未开始",
    RUNNING: "处理中",
    RETRY_WAITING: "等待重试",
    FAILED_FINAL: "处理未完成",
    REVERSING: "正在退回",
    REVERSED: "已退回",
    PARTIALLY_REFUNDED: "部分退款",
    REQUESTED: "已申请",
    CANCELLED: "已取消",
    SCHEDULED: "待生效",
    ACTIVE: "使用中",
    EXPIRED: "已到期",
    TERMINATED_BY_UPGRADE: "升级后已结束",
    AVAILABLE: "可使用",
    RESERVED: "使用中",
    FROZEN: "暂不可用",
    EXHAUSTED: "已用完",
    FORFEITED: "因权益变更已结束",
  };
  return labels[value] ?? "状态更新中";
}

function CommerceFrame({ title, eyebrow, backHref = ROUTES.my, children }: { title: string; eyebrow?: string; backHref?: string; children: ReactNode }) {
  return (
    <ProtectedRoute>
      <RouteFrame title={title} label={title} mode="commerce-mode">
        <section className="r11-commerce">
          <header className="commerce-topbar">
            <Link href={backHref} aria-label="返回上一页">‹</Link>
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

function useCommerceBack(fallback: AppPath) {
  const [backHref, setBackHref] = useState<AppPath>(fallback);
  useEffect(() => {
    const timer = window.setTimeout(() => setBackHref(safeReturnPath(readQuery().get("from"), fallback)), 0);
    return () => window.clearTimeout(timer);
  }, [fallback]);
  return backHref;
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
  const backHref = useCommerceBack(ROUTES.my);
  useEffect(() => { const timer = window.setTimeout(() => setReturnTo(readQuery().get("returnTo") === ROUTES.readingPrepare ? ROUTES.readingPrepare : ""), 0); return () => window.clearTimeout(timer); }, []);
  const loader = useCallback(() => Promise.all([api.serviceOfferings(), api.moneyOrders()]), []);
  const { data, error } = useLoad(loader, [loader]);
  if (error) return <RouteError message={error} backHref={ROUTES.my} />;
  if (!data) return <RouteSkeleton label="正在获取最新商品与会员方案…" />;
  const [offerings, orders] = data;
  const services = offerings.filter((item) => item.kind !== "MEMBERSHIP_PLAN");
  const fulfilledPurchases = orders.filter((order) => order.status === "FULFILLED").reduce<Record<string, number>>((counts, order) => {
    const id = orderOffering(order).offeringId;
    if (id) counts[id] = (counts[id] ?? 0) + 1;
    return counts;
  }, {});
  return (
    <CommerceFrame title="服务商城" eyebrow="选择服务" backHref={backHref}>
      <section className="fresh-store-hero">
        <h2>选择此刻需要的陪伴</h2>
        <p>每一份服务的内容、次数与有效期，都以后端实时信息为准。</p>
      </section>
      <section className="commerce-section fresh-store-section">
        <header><h2>按需选择</h2><small>单独购买，独立使用</small></header>
        {services.length
          ? <div className="offering-list">{services.map((item) => <OfferingCard key={item.offeringId} offering={item} returnTo={returnTo} purchaseLimitReached={typeof item.purchaseLimit === "number" && (fulfilledPurchases[item.offeringId] ?? 0) >= item.purchaseLimit} />)}</div>
          : <div className="commerce-empty">服务正在准备中，请稍后再来看看。</div>}
      </section>
      <div className="fresh-store-boundary"><strong>清楚、独立的服务权益</strong><p>会员与服务包分别记录，页面会实时更新可用次数和有效期。智慧种子只用于活动资格，不折算金额，也不与人民币组合支付。</p></div>
      <div className="commerce-context-actions"><Link href={withReturnPath(ROUTES.myBenefits, ROUTES.shop)}>查看我的服务权益 <span>→</span></Link><Link href={withReturnPath(`${ROUTES.myOrders}?kind=service`, ROUTES.shop)}>查看已购买的服务 <span>→</span></Link></div>
    </CommerceFrame>
  );
}

function OfferingCard({ offering, returnTo = "", purchaseLimitReached = false }: { offering: ServiceOffering; returnTo?: string; purchaseLimitReached?: boolean }) {
  const quantity = offering.benefits.reduce((sum, benefit) => sum + benefit.quantity, 0);
  return (
    <Link className="offering-card fresh-offering-card" href={`${ROUTES.shopDetail}?offeringId=${encodeURIComponent(offering.offeringId)}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`}>
      <i>{offering.kind === "SERVICE_PACK" ? "包" : "次"}</i>
      <span><small>{kindLabel(offering.kind)}</small><strong>{productName(offering.name)}</strong><p>{quantity} {offering.benefits[0]?.unit === "COUNT" ? "次" : "份"} · 购买后 {offering.validityDays} 天有效</p></span>
      <b>{purchaseLimitReached ? "已购买" : money(offering.price.amount)}</b>
    </Link>
  );
}

export function ShopDetailScreen() {
  const [offeringId, setOfferingId] = useState("");
  const [returnTo, setReturnTo] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => { const query = readQuery(); setOfferingId(query.get("offeringId") ?? ""); setReturnTo(query.get("returnTo") === ROUTES.readingPrepare ? ROUTES.readingPrepare : ""); setReady(true); }, 0); return () => window.clearTimeout(timer); }, []);
  const loader = useCallback(() => offeringId ? Promise.all([api.serviceOffering(offeringId), api.currentMembership(), api.moneyOrders()]) : Promise.resolve(null), [offeringId]);
  const { data, error } = useLoad(loader, [loader, offeringId]);
  if (!ready) return <RouteSkeleton label="正在读取商品详情…" />;
  if (!offeringId) return <RouteError title="商品地址无效" message="没有找到对应商品。" backHref={ROUTES.shop} />;
  if (error) return <RouteError message={error} backHref={ROUTES.shop} />;
  if (!data) return <RouteSkeleton label="正在读取商品详情…" />;
  const [offering, membership, orders] = data;
  const fulfilledPurchaseCount = orders.filter((order) => order.status === "FULFILLED" && orderOffering(order).offeringId === offering.offeringId).length;
  const purchaseLimitReached = typeof offering.purchaseLimit === "number" && fulfilledPurchaseCount >= offering.purchaseLimit;
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
    <CommerceFrame title={productName(offering.name)} eyebrow={kindLabel(offering.kind)} backHref={ROUTES.shop}>
      <div className="offering-hero"><span>{serviceLabel(offering.serviceType)}</span><strong>{money(offering.price.amount)}</strong><small>结算前会再次确认金额</small></div>
      <section className="detail-facts">
        {offering.benefits.map((benefit, index) => <p key={`${benefit.serviceType}-${index}`}><span>{serviceLabel(benefit.serviceType)}</span><strong>{benefit.quantity} 次</strong></p>)}
        <p><span>有效期</span><strong>{offering.kind === "MEMBERSHIP_PLAN" ? `${offering.validityDays} 天会员周期` : `购买日起 ${offering.validityDays} 天`}</strong></p>
        <p><span>生效方式</span><strong>{isRenewal ? "当前周期结束后按顺序生效" : offering.kind === "MEMBERSHIP_PLAN" ? "支付完成并到账后生效" : "每个服务包分别计时"}</strong></p>
      </section>
      <div className="commerce-safe-note">使用服务时，系统会自动选择当前可用的次数或智慧种子，无需手动设置。</div>
      {purchaseLimitReached
        ? <div className="commerce-safe-note"><strong>该体验服务每位用户限购一次</strong><br />你已经购买过，可以选择其他可用项目或会员计划。</div>
        : membershipChangeUnavailable
        ? <div className="commerce-safe-note">当前方案不能降级购买；你可以续费当前方案，或升级到更高方案。</div>
        : <Link className="commerce-primary" href={checkoutHref}>{isRenewal ? "续费当前方案" : isUpgrade ? "升级当前方案" : "立即购买"}</Link>}
    </CommerceFrame>
  );
}

export function CheckoutScreen() {
  const router = useRouter();
  const paymentRequestKey = useRef<string>("");
  const orderRef = useRef<MoneyOrder | null>(null);
  const paymentRef = useRef<PaymentAttempt | null>(null);
  const [params, setParams] = useState<{ offeringId: string; returnTo: string; previousSubscriptionId: string; targetPlanVersionId: string }>({ offeringId: "", returnTo: ROUTES.shop, previousSubscriptionId: "", targetPlanVersionId: "" });
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [upgradeNotice, setUpgradeNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [businessContext, setBusinessContext] = useState<BusinessContext | null>(null);
  const [payerPreparation, setPayerPreparation] = useState<"preparing" | "ready" | "blocked">("preparing");
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
    if (!ready || !params.offeringId) return;
    const key = `fresh:checkout:${params.offeringId}`;
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(key) ?? "null") as { order?: MoneyOrder; payment?: PaymentAttempt; requestKey?: string } | null;
      if (saved?.order) orderRef.current = saved.order;
      if (saved?.payment) paymentRef.current = saved.payment;
      if (saved?.requestKey) paymentRequestKey.current = saved.requestKey;
    } catch { window.sessionStorage.removeItem(key); }
    const query = new URLSearchParams(window.location.search);
    if (query.get("wechatPaymentTicket")) { const timer = window.setTimeout(() => setPayerPreparation("ready"), 0); return () => window.clearTimeout(timer); }
    let active = true;
    void api.prepareWechatPaymentPayer(`${window.location.pathname}${window.location.search}`).then((preparation) => {
      if (!active) return;
      if (!preparation.required) { setPayerPreparation("ready"); return; }
      if (!/MicroMessenger/i.test(window.navigator.userAgent)) {
        setError("请在微信中打开此页面后支付");
        setPayerPreparation("blocked");
        return;
      }
      if (!preparation.authorizationUrl) throw new Error("微信支付授权地址不可用");
      window.location.replace(preparation.authorizationUrl);
    }).catch((reason) => { if (active) { setError(apiMessage(reason)); setPayerPreparation("blocked"); } });
    return () => { active = false; };
  }, [params.offeringId, ready]);
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
    if (!quote || busy || payerPreparation !== "ready") return;
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams(window.location.search);
      const payerTicket = query.get("wechatPaymentTicket") ?? undefined;
      const order = orderRef.current ?? await api.createMoneyOrder(quote.quoteId);
      orderRef.current = order;
      if (params.previousSubscriptionId && params.targetPlanVersionId) {
        await api.registerMembershipUpgrade({
          previousSubscriptionId: params.previousSubscriptionId,
          targetPlanVersionId: params.targetPlanVersionId,
          newOrderId: order.orderId,
        });
      }
      if (!paymentRequestKey.current) paymentRequestKey.current = crypto.randomUUID();
      const payment = paymentRef.current ?? await api.createPaymentAttempt(order.orderId, payerTicket, paymentRequestKey.current);
      paymentRef.current = payment;
      window.sessionStorage.setItem(`fresh:checkout:${params.offeringId}`, JSON.stringify({ order, payment, requestKey: paymentRequestKey.current }));
      if (payerTicket) { query.delete("wechatPaymentTicket"); window.history.replaceState(window.history.state, "", `${window.location.pathname}${query.size ? `?${query.toString()}` : ""}`); }
      savePendingCommerceContext({
        orderId: order.orderId,
        paymentAttemptId: payment.paymentAttemptId,
        businessContext,
        returnPath: params.returnTo,
        savedAt: new Date().toISOString(),
      });
      if (payment.provider === "WECHAT_PAY") {
        const result = await invokeWechatPay(payment.clientParameters);
        if (result === "cancel") { setError("本次支付已取消，你可以稍后重新支付。"); setBusy(false); return; }
        if (result === "fail" || result === "unavailable") { setError(result === "unavailable" ? "暂时无法调起微信支付，请确认已在微信中打开后重试。" : "微信支付未完成，请重新尝试。"); setBusy(false); return; }
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
  if (!quote) return <RouteSkeleton label="正在确认购买信息…" />;
  return (
    <CommerceFrame title="确认订单" eyebrow="价格与资格确认" backHref={ROUTES.shop}>
      <div className="checkout-card">
        <small>{kindLabel(quote.offering.kind)}</small><h2>{productName(quote.offering.name)}</h2>
        <p><span>应付金额</span><strong>{money(quote.price.amount)}</strong></p>
        <p><span>请在此时间前支付</span><strong>{new Date(quote.expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</strong></p>
        <p><span>支付方式</span><strong>微信支付</strong></p>
      </div>
      {quote.promotion.eligible && quote.promotion.seedReservationRequired > 0 ? <div className="commerce-safe-note">已满足智慧种子活动资格，将按活动价格支付；智慧种子仅用于确认活动资格。</div> : null}
      {upgradeNotice ? <div className="upgrade-notice"><strong>升级确认</strong><p>{upgradeNotice}</p><p>新方案生效后原方案结束，原方案未使用次数不保留。</p></div> : null}
      {error ? <p className="commerce-error" role="alert">{error}</p> : null}
      <button className="commerce-primary" type="button" disabled={busy || payerPreparation !== "ready"} onClick={() => void submit()}>{payerPreparation === "blocked" ? "请在微信中打开后支付" : payerPreparation === "preparing" ? "正在准备微信支付…" : busy ? "正在提交…" : `微信支付 ${money(quote.price.amount)}`}</button>
      <p className="commerce-footnote">支付完成后，服务可能需要几秒到账，请勿重复支付。</p>
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
  if ((!order || !payment) && error) return <RouteError title="暂时无法确认支付结果" message={error} backHref={ROUTES.myOrders} />;
  if (!order || !payment) return <RouteSkeleton label="正在确认支付与服务到账结果…" />;
  const fulfilled = order.status === "FULFILLED";
  const paid = payment.status === "SUCCEEDED" || ["PAID", "FULFILLING", "FULFILLED"].includes(order.status);
  const failed = ["FAILED", "CLOSED"].includes(payment.status) || order.status === "FULFILLMENT_FAILED";
  const title = fulfilled ? "权益已经到账" : paid ? "支付成功，权益发放中" : failed ? "本次支付未完成" : "正在确认支付结果";
  return (
    <CommerceFrame title={title} eyebrow="支付与权益进度" backHref={ROUTES.myOrders}>
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
  const backHref = useCommerceBack(ROUTES.my);
  const loader = useCallback(() => Promise.all([api.entitlements(), api.usageRecords()]), []);
  const { data, error } = useLoad(loader, [loader]);
  if (error) return <RouteError message={error} backHref={ROUTES.my} />;
  if (!data) return <RouteSkeleton label="正在读取可用服务…" />;
  const [grants, records] = data;
  const grouped = grants.reduce<Record<string, EntitlementGrant[]>>((all, grant) => {
    (all[grant.sourceType] ??= []).push(grant); return all;
  }, {});
  return (
    <CommerceFrame title="我的服务权益" eyebrow="服务权益明细" backHref={backHref}>
      <p className="commerce-lead">每份权益都有自己的使用次数和有效期，可以分别查看。</p>
      {Object.entries(grouped).map(([source, items]) => <section className="benefit-group" key={source}><header><h2>{SOURCE_NAMES[source] ?? source}</h2><span>{items.reduce((sum, item) => sum + item.available, 0)} 次可用</span></header>{items.map((grant) => <GrantCard key={grant.entitlementId} grant={grant} />)}</section>)}
      {grants.length === 0 ? <div className="commerce-empty">还没有可展示的服务权益</div> : null}
      <section className="commerce-section"><header><h2>服务次数变化记录</h2><small>每次增加、使用、退回或到期都会记录</small></header><UsageList records={records} /></section>
    </CommerceFrame>
  );
}

function GrantCard({ grant }: { grant: EntitlementGrant }) {
  return <article className="grant-card"><i>{serviceLabel(grant.serviceType).slice(0, 1)}</i><span><strong>{serviceLabel(grant.serviceType)}</strong><small>{date(grant.validFrom)} — {date(grant.expiresAt)}</small><p>{statusLabel(grant.status)}{grant.reserved > 0 ? ` · ${grant.reserved} 次正在使用中` : ""}</p></span><b>{grant.available}<small> / {grant.total}</small></b></article>;
}

function usageDescription(record: UsageRecord) {
  const descriptions: Record<UsageRecord["type"], string> = {
    GRANT: "新增可用次数",
    RESERVE: "本次服务暂时占用",
    COMMIT: "本次服务已经完成",
    RELEASE: "服务未完成，次数已经退回",
    REVERSE: "原使用记录已撤回，次数已经退回",
    EXPIRE: "超过有效期，未使用次数已经结束",
    FREEZE: "这部分次数暂时不能使用",
    UNFREEZE: "这部分次数已经恢复使用",
    FORFEIT: "权益发生变更，未使用次数已经结束",
    ADJUSTMENT: "官方调整可用次数",
  };
  return descriptions[record.type];
}

function usageQuantity(record: UsageRecord) {
  const adds = ["GRANT", "RELEASE", "REVERSE", "UNFREEZE"];
  const removes = ["RESERVE", "COMMIT", "EXPIRE", "FREEZE", "FORFEIT"];
  const prefix = adds.includes(record.type) ? "+" : removes.includes(record.type) ? "−" : record.quantity >= 0 ? "+" : "−";
  return `${prefix}${Math.abs(record.quantity)} 次`;
}

function usageIcon(record: UsageRecord) {
  if (record.businessContext.type === "CARD_READING_INTENT") return "问";
  if (record.businessContext.type === "DAILY_INSIGHT") return "日";
  return "变";
}

function UsageList({ records }: { records: UsageRecord[] }) {
  if (!records.length) return <div className="commerce-empty">暂无使用记录</div>;
  return <><div className="usage-list plain-language">{records.slice(0, 20).map((record) => <p key={record.recordId}><i>{usageIcon(record)}</i><span><b>{usageDescription(record)}</b><small>{date(record.createdAt)} · {CONTEXT_NAMES[record.businessContext.type] ?? "服务次数调整"}</small></span><strong>{usageQuantity(record)}</strong></p>)}</div><div className="commerce-safe-note">“退回”表示之前暂时占用的次数重新可以使用；“结束”表示该批次不能继续使用，常见于到期或会员方案变更。</div></>;
}

export function OrdersScreen() {
  const backHref = useCommerceBack(ROUTES.my);
  const [kind, setKind] = useState<"membership" | "service" | "all">("all");
  const loader = useCallback(() => api.moneyOrders(), []);
  const { data: orders, error, setData } = useLoad(loader, [loader]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const value = readQuery().get("kind");
      setKind(value === "membership" || value === "service" ? value : "all");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function cancel(orderId: string) {
    const updated = await api.cancelMoneyOrder(orderId);
    setData((orders ?? []).map((item) => item.orderId === orderId ? updated : item));
  }
  if (error) return <RouteError message={error} backHref={ROUTES.my} />;
  if (!orders) return <RouteSkeleton label="正在读取订单…" />;
  const visibleOrders = orders.filter((order) => kind === "all" || (kind === "membership") === (orderOffering(order).kind === "MEMBERSHIP_PLAN"));
  const title = kind === "membership" ? "会员订单" : kind === "service" ? "服务订单" : "我的订单";
  return (
    <CommerceFrame title={title} eyebrow="购买记录" backHref={backHref}>
      <div className="order-list">{visibleOrders.map((order) => { const offering = orderOffering(order); const paymentStarted = order.paymentStatus !== "NOT_STARTED"; return <article className="order-card" key={order.orderId}><header><small>{order.orderNumber}</small><b>{statusLabel(order.status)}</b></header><h2>{offering.name}</h2><p><span>{date(order.createdAt)}</span><strong>{money(order.amount.amount)}</strong></p><footer>{order.status === "AWAITING_PAYMENT" ? <>{paymentStarted ? <span>正在确认支付结果，请勿重复支付</span> : <button onClick={() => void cancel(order.orderId)}>关闭订单</button>}{!paymentStarted && offering.offeringId ? <Link href={`${ROUTES.checkout}?offeringId=${encodeURIComponent(offering.offeringId)}`}>重新确认并支付</Link> : null}</> : null}{order.status === "FULFILLED" && offering.kind !== "MEMBERSHIP_PLAN" ? <Link href={`${ROUTES.myRefunds}?orderId=${encodeURIComponent(order.orderId)}`}>查看退款条件</Link> : null}</footer></article>; })}</div>
      {visibleOrders.length === 0 ? <div className="commerce-empty">这里还没有订单</div> : null}
    </CommerceFrame>
  );
}
export function MembershipScreen() {
  const backHref = useCommerceBack(ROUTES.shop);
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
  const visiblePeriods = periods.filter((period) => period.status === "ACTIVE" || period.status === "SCHEDULED");
  const historyPeriods = periods.filter((period) => period.status !== "ACTIVE" && period.status !== "SCHEDULED");
  return (
    <CommerceFrame title="会员计划" eyebrow="30 天陪伴计划" backHref={backHref}>
      <section className="fresh-membership-hero">
        <h2>按你的节奏<br />选择陪伴深度</h2>
        <p>三档计划均包含今日能量与抽卡问事服务，套餐、价格与周期会实时更新。</p>
        {active ? <div><span>当前计划</span><strong>{PLAN_NAMES[active.planCode]}计划</strong><b>还剩 {remainingDays} 天</b></div> : <div><span>当前计划</span><strong>尚未开通</strong><b>选择后开始</b></div>}
      </section>
      <div className="fresh-plan-note"><strong>续费与升级</strong><p>续费周期在当前周期结束后依次开始；升级会在新方案安全生效后结束原方案，暂不支持降级。</p></div>
      <div className="fresh-membership-plans">{plans.map((plan) => <MembershipAction key={plan.offeringId} plan={plan} membership={membership} activePlanCode={active?.planCode} currentRank={currentRank} />)}</div>
      {periods.length ? <section className="commerce-section fresh-period-section"><header><h2>会员记录</h2><small>当前与即将生效的计划</small></header>{visiblePeriods.length ? <PeriodList periods={visiblePeriods} /> : <div className="commerce-empty">当前没有正在使用或等待生效的计划</div>}{historyPeriods.length ? <details className="membership-history"><summary>查看过去的会员计划</summary><PeriodList periods={historyPeriods} /></details> : null}</section> : null}
      <div className="fresh-store-boundary"><strong>共同规则</strong><p>权益按会员周期记录，未使用次数到期不结转；会员名称表示陪伴方案，不是身份等级。</p></div>
      <div className="commerce-context-actions"><Link href={withReturnPath(`${ROUTES.myOrders}?kind=membership`, ROUTES.myMembership)}>查看会员订单 <span>→</span></Link></div>
    </CommerceFrame>
  );
}

function PeriodList({ periods }: { periods: MembershipSubscription["periods"] }) {
  return <div className="period-list">{periods.map((period) => <p key={period.periodId}><i>{PLAN_NAMES[period.planCode]}</i><span>{date(period.startsAt)} — {date(period.endsAt)}</span><strong>{statusLabel(period.status)}</strong></p>)}</div>;
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
    <div><small>{PLAN_NAMES[plan.planCode]} · 30 天</small><h2>{productName(plan.name)}</h2><p>{benefits}</p><strong>{money(plan.price.amount)}<i> / 30 天</i></strong><b>{downgrade ? "当前不可降级" : renewal ? "续费当前方案 ›" : membership ? "升级方案 ›" : "查看并开通 ›"}</b></div>
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
    <CommerceFrame title="普通退款" eyebrow="未使用服务退款" backHref={ROUTES.myOrders}>
      <p className="commerce-lead">仅支持尚未使用、也未进入服务流程的普通订单。会员升级前的剩余服务不属于退款范围。</p>
      {orderId ? <div className="refund-action"><small>订单</small><strong>{orderId}</strong>{quote ? <><p>预计退款金额：{money(quote.amount.amount)}</p><p>请在此时间前确认：{date(quote.expiresAt)}</p><button disabled={busy} onClick={() => void request()}>确认申请退款</button></> : <button disabled={busy} onClick={() => void check()}>{busy ? "正在检查…" : "查看是否可以退款"}</button>}</div> : <div className="commerce-safe-note">请从“我的订单”选择需要退款的订单。</div>}
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
    <CommerceFrame title={selected ? "本次问事权益已确认" : "需要先获得问事权益"} eyebrow="系统自动选择" backHref={ROUTES.readings}>
      {selected ? <><div className="resolution-card"><small>系统自动选择</small><h2>{SOURCE_NAMES[selected.sourceType] ?? selected.sourceType}</h2><p>本次使用 {selected.cost} {selected.unit === "WISDOM_SEED" ? "颗智慧种子" : "次服务"}</p>{selected.expiresAt ? <span>有效至 {date(selected.expiresAt)}</span> : null}</div><div className="commerce-safe-note">系统会自动使用合适的可用次数，无需手动选择。</div><button className="commerce-primary" disabled={busy} onClick={() => void reserve()}>{busy ? "正在确认…" : "确认后进入抽卡"}</button></> : <><div className="commerce-empty">当前会员服务、已购服务包和可用智慧种子均不足。</div><Link className="commerce-primary" href={`${ROUTES.shop}?returnTo=${encodeURIComponent(ROUTES.readingPrepare)}`}>查看问事服务包</Link></>}
      {error ? <p className="commerce-error">{error}</p> : null}
    </CommerceFrame>
  );
}
