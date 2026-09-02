import type { components } from "./contracts/generated";
import { PROTOTYPE_MODE } from "@/src/shared/prototype";
import { prototypeAccount,prototypeDailyInsight,prototypeFirstLook,prototypeHome,prototypeProfiles,prototypeRevision,prototypeTransactions } from "@/src/shared/prototypeData";
import { trackBusinessRequestFailed, trackBusinessRequestStarted, trackBusinessRequestSucceeded } from "@/src/analytics/businessEvents";
import { setAnalyticsAccessToken } from "@/src/analytics/client";

type Schemas = components["schemas"];
type Bootstrap = Schemas["BootstrapEnvelope"]["data"];
type Session = Schemas["SessionEnvelope"]["data"];
type Me = Schemas["MeEnvelope"]["data"];
type HomeOverview = Schemas["HomeOverviewEnvelope"]["data"];
type Location = Schemas["Location"];
type ProfileRevision = Schemas["ProfileRevision"];
type ProfileConfirmation = Schemas["ProfileConfirmation"];
type ProfileFirstLook = Schemas["ProfileFirstLook"];
type RegistrationReward = Schemas["RegistrationReward"];
type WisdomSeedAccount = Schemas["WisdomSeedAccount"];
type WisdomSeedTransaction = Schemas["WisdomSeedTransaction"];
type DailyInsight = Schemas["DailyInsight"];
type GenerationTask = Schemas["GenerationTask"];
type LifeProfile = Schemas["LifeProfile"];
type ProfileGroup = Schemas["ProfileGroup"];
type ServiceOffering = Schemas["ServiceOffering"];
type MembershipPlan = Schemas["MembershipPlan"];
type CheckoutQuote = Schemas["CheckoutQuote"];
type MoneyOrder = Schemas["MoneyOrder"];
type PaymentAttempt = Schemas["PaymentAttempt"];
type EntitlementGrant = Schemas["EntitlementGrant"];
type UsageRecord = Schemas["UsageRecord"];
type EntitlementResolution = Schemas["EntitlementResolution"];
type ConsumptionIntent = Schemas["ConsumptionIntent"];
type MembershipSubscription = Schemas["MembershipSubscription"];
type RefundQuote = Schemas["RefundQuote"];
type Refund = Schemas["Refund"];
type BusinessContext = Schemas["BusinessContext"];
export type CardReadingCard = { position: number; positionLabel: string; cardCode: string; displayName: string };
export type CardReading = { readingId: string; question: string; category: string; cardCount: number; status: "DRAWN" | "GENERATING" | "READY" | "FAILED"; cards: CardReadingCard[]; failure: { code?: string; message?: string; retryable?: boolean } | null; createdAt: string; updatedAt: string; completedAt: string | null };

export type {
  Bootstrap,
  DailyInsight,
  GenerationTask,
  HomeOverview,
  LifeProfile,
  Location,
  Me,
  ProfileConfirmation,
  ProfileFirstLook,
  ProfileGroup,
  ProfileRevision,
  RegistrationReward,
  Session,
  WisdomSeedAccount,
  WisdomSeedTransaction,
  ServiceOffering,
  MembershipPlan,
  CheckoutQuote,
  MoneyOrder,
  PaymentAttempt,
  EntitlementGrant,
  UsageRecord,
  EntitlementResolution,
  ConsumptionIntent,
  MembershipSubscription,
  RefundQuote,
  Refund,
  BusinessContext,
};
export type BirthInput = Schemas["BirthInput"];
export const CONSENT_REQUIRED_EVENT = "satori:consent-required";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "API_ERROR",
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const API_BASE = "/api/v1";
const prototypeNow = "2026-08-28T10:00:00.000Z";
const prototypeMe = {
  userId: "prototype-user",
  status: "ACTIVE",
  phoneMasked: "186****9401",
  requiresConsent: false,
  createdAt: prototypeNow,
  preferences: { timezone: "Asia/Shanghai", locale: "zh-CN" },
  profileState: "ACTIVE",
  nextAction: "VIEW_HOME",
} as Me;
const prototypeBootstrap = {
  serverTime: prototypeNow,
  apiVersion: "v1",
  configVersion: "r1.1-prototype",
  maintenance: { enabled: false, message: null },
  clientPolicy: {},
  features: { readings: true, commerce: true, membership: true },
  requiredLegalDocuments: [],
} as Bootstrap;
const prototypeChallenge = {
  challengeId: "prototype-sms-challenge",
  expiresAt: prototypeNow,
  resendAvailableAt: prototypeNow,
  phoneMasked: "186****9401",
};
const prototypeConfirmation = {
  profileId: "prototype-profile",
  revisionId: "prototype-revision",
  revisionNumber: 1,
  status: "ACTIVE",
  astrologySnapshotId: "prototype-snapshot",
  confirmedAt: prototypeNow,
  reportImpact: {
    currentLifeReportStillAvailable: true,
    currentLifeReportBasedOnPreviousRevision: false,
    newLifeReportCanBeGenerated: true,
  },
} as ProfileConfirmation;
const prototypeTask = {
  taskId: "prototype-daily-task",
  type: "DAILY_INSIGHT_GENERATION",
  status: "READY",
  stage: "COMPLETED",
  stageLabel: "已完成",
  canRetry: false,
  target: { type: "DAILY_INSIGHT", id: "prototype-daily" },
  createdAt: prototypeNow,
  updatedAt: prototypeNow,
  completedAt: prototypeNow,
} as GenerationTask;

function prototypeResult<T>(data: T) {
  return Promise.resolve(data);
}

function idempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `satori-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getDevice() {
  const fallback = `web-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  let deviceId = fallback;
  if (typeof window !== "undefined") {
    deviceId = window.localStorage.getItem("satori-device-id") || fallback;
    window.localStorage.setItem("satori-device-id", deviceId);
  }
  return {
    deviceId,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
    appVersion: "r1.0-web",
  };
}

class SatoriApiClient {
  private accessToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;

  setAccessToken(token: string | null) {
    this.accessToken = token;
    setAnalyticsAccessToken(token);
  }

  private async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const method = (init.method || "GET").toUpperCase();
    if (retry) trackBusinessRequestStarted({ method, path });
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    if (this.accessToken) headers.set("Authorization", `Bearer ${this.accessToken}`);

    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });

    if (response.status === 401 && retry && path !== "/auth/sessions/refresh") {
      if (await this.refresh()) return this.request<T>(path, init, false);
    }

    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const failure = payload?.error;
      if (failure?.code === "CONSENT_REQUIRED" && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(CONSENT_REQUIRED_EVENT, {
          detail: { requestId: failure.requestId },
        }));
      }
      trackBusinessRequestFailed({ method, path }, {
        status: response.status,
        code: failure?.code,
        requestId: failure?.requestId,
      });
      throw new ApiError(
        failure?.message || `请求失败（HTTP ${response.status}）`,
        response.status,
        failure?.code,
        failure?.requestId,
      );
    }
    trackBusinessRequestSucceeded({ method, path }, payload);
    return payload as T;
  }

  private command<T>(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("Idempotency-Key")) headers.set("Idempotency-Key", idempotencyKey());
    return this.request<T>(path, { ...init, headers });
  }

  async refresh() {
    if (PROTOTYPE_MODE) {
      this.setAccessToken("prototype-access-token");
      return true;
    }
    if (!this.refreshing) {
      this.refreshing = this.request<Schemas["RefreshSessionEnvelope"]>(
        "/auth/sessions/refresh",
        { method: "POST" },
        false,
      ).then(({ data }) => {
        this.setAccessToken(data.accessToken);
        return true;
      }).catch(() => {
        this.setAccessToken(null);
        return false;
      }).finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  async logout() {
    if (PROTOTYPE_MODE) {
      this.setAccessToken(null);
      return;
    }
    await this.request<null>("/auth/sessions/current", { method: "DELETE" });
    // The bearer token lives only in memory; the revoked session cannot be reused.
    this.setAccessToken(null);
  }

  bootstrap() {
    if (PROTOTYPE_MODE) return prototypeResult(prototypeBootstrap);
    return this.request<Schemas["BootstrapEnvelope"]>("/app/bootstrap").then((x) => x.data);
  }

  sendSms(phone: string) {
    if (PROTOTYPE_MODE) return prototypeResult({ ...prototypeChallenge, phoneMasked: `${phone.slice(0, 3)}****${phone.slice(-4)}` });
    return this.command<Schemas["SmsChallengeEnvelope"]>("/auth/sms-challenges", {
      method: "POST",
      body: JSON.stringify({
        phone: { countryCode: "+86", nationalNumber: phone },
        purpose: "LOGIN",
        device: getDevice(),
      }),
    }).then((x) => x.data);
  }

  createSession(challengeId: string, verificationCode: string, consentAcceptances: Schemas["ConsentAcceptance"][]) {
    if (PROTOTYPE_MODE) {
      this.setAccessToken("prototype-access-token");
      return prototypeResult({
        accessToken: this.accessToken,
        accessTokenExpiresAt: "2026-08-29T10:00:00.000Z",
        sessionId: "prototype-session",
        isNewUser: false,
        user: prototypeMe,
        nextAction: "VIEW_HOME" as const,
      });
    }
    return this.command<Schemas["SessionEnvelope"]>("/auth/sessions", {
      method: "POST",
      body: JSON.stringify({ challengeId, verificationCode, consentAcceptances, device: getDevice() }),
    }).then(({ data }) => {
      this.setAccessToken(data.accessToken);
      return data;
    });
  }

  acceptConsents(acceptances: Schemas["ConsentAcceptance"][]) {
    if (PROTOTYPE_MODE) return prototypeResult({ records: acceptances, requiresConsent: false, nextAction: "VIEW_HOME" as const });
    return this.command<Schemas["ConsentEnvelope"]>("/me/consents", {
      method: "POST",
      body: JSON.stringify({ acceptances }),
    }).then((x) => x.data);
  }

  me() { return PROTOTYPE_MODE ? prototypeResult(prototypeMe) : this.request<Schemas["MeEnvelope"]>("/me").then((x) => x.data); }
  home() { return PROTOTYPE_MODE?Promise.resolve(prototypeHome):this.request<Schemas["HomeOverviewEnvelope"]>("/me/home-overview").then((x) => x.data); }
  selfProfile() { return PROTOTYPE_MODE ? prototypeResult(prototypeProfiles[0]) : this.request<Schemas["LifeProfileEnvelope"]>("/me/life-profile").then((x) => x.data); }
  updateSelfProfile(displayName: string) {
    if (PROTOTYPE_MODE) return prototypeResult({ ...prototypeProfiles[0], displayName });
    return this.request<Schemas["LifeProfileEnvelope"]>("/me/life-profile", {
      method: "PATCH", body: JSON.stringify({ displayName }),
    }).then((x) => x.data);
  }
  profileRevision(revisionId: string) {
    if(PROTOTYPE_MODE)return Promise.resolve(prototypeRevision);
    return this.request<Schemas["ProfileRevisionEnvelope"]>(`/me/life-profile/revisions/${revisionId}`).then((x) => x.data);
  }
  searchLocations(query: string) {
    if (PROTOTYPE_MODE) return prototypeResult([] as Location[]);
    return this.request<Schemas["LocationListEnvelope"]>(`/locations?query=${encodeURIComponent(query)}&limit=8`).then((x) => x.data);
  }
  previewProfile(birthInput: BirthInput) {
    if (PROTOTYPE_MODE) return prototypeResult(prototypeRevision);
    return this.command<Schemas["ProfileRevisionEnvelope"]>("/me/life-profile/revisions/preview", {
      method: "POST", body: JSON.stringify({ birthInput }),
    }).then((x) => x.data);
  }
  confirmProfile(revisionId: string, fingerprint: string, enhancedConfirmationAccepted: boolean) {
    if (PROTOTYPE_MODE) return prototypeResult({ ...prototypeConfirmation, revisionId });
    return this.command<Schemas["ProfileConfirmationEnvelope"]>(`/me/life-profile/revisions/${revisionId}/confirm`, {
      method: "POST", body: JSON.stringify({ fingerprint, enhancedConfirmationAccepted }),
    }).then((x) => x.data);
  }
  profileFirstLook(revisionId: string) {
    if(PROTOTYPE_MODE)return Promise.resolve(prototypeFirstLook);
    return this.request<Schemas["ProfileFirstLookEnvelope"]>(`/me/life-profile/revisions/${revisionId}/first-look`).then((x) => x.data);
  }
  generateProfileFirstLook(revisionId: string) {
    if (PROTOTYPE_MODE) return prototypeResult({ ...prototypeFirstLook, profileRevisionId: revisionId });
    return this.command<Schemas["ProfileFirstLookEnvelope"]>(`/me/life-profile/revisions/${revisionId}/first-look`, {
      method: "POST",
    }).then((x) => x.data);
  }
  registrationReward() { return PROTOTYPE_MODE ? prototypeResult(prototypeHome.registrationReward as RegistrationReward) : this.request<Schemas["RegistrationRewardEnvelope"]>("/me/registration-reward").then((x) => x.data); }
  claimRegistrationReward() {
    if (PROTOTYPE_MODE) return prototypeResult({ reward: prototypeHome.registrationReward as RegistrationReward, account: prototypeAccount, transaction: prototypeTransactions[0] });
    return this.command<Schemas["RegistrationRewardClaimEnvelope"]>("/me/registration-reward/claim", { method: "POST" }).then((x) => x.data);
  }
  seedAccount() { return PROTOTYPE_MODE?Promise.resolve(prototypeAccount):this.request<Schemas["WisdomSeedAccountEnvelope"]>("/me/wisdom-seed-account").then((x) => x.data); }
  seedTransactions() { return PROTOTYPE_MODE?Promise.resolve(prototypeTransactions):this.request<Schemas["WisdomSeedTransactionListEnvelope"]>("/me/wisdom-seed-transactions?limit=50").then((x) => x.data); }
  createTodayInsight() {
    if (PROTOTYPE_MODE) return prototypeResult({ dailyInsight: prototypeDailyInsight, task: null });
    return this.command<Schemas["DailyInsightCommandEnvelope"]>("/daily-insights/today", { method: "POST" }).then((x) => x.data);
  }
  dailyInsight(localDate: string) {
    if(PROTOTYPE_MODE)return Promise.resolve({...prototypeDailyInsight,localDate});
    return this.request<Schemas["DailyInsightEnvelope"]>(`/daily-insights/${localDate}`).then((x) => x.data);
  }
  generationTask(taskId: string) {
    if (PROTOTYPE_MODE) return prototypeResult({ ...prototypeTask, taskId });
    return this.request<Schemas["GenerationTaskEnvelope"]>(`/generation-tasks/${taskId}`).then((x) => x.data);
  }
  profiles() { return PROTOTYPE_MODE?Promise.resolve(prototypeProfiles):this.request<Schemas["LifeProfileListEnvelope"]>("/me/life-profiles?limit=50").then((x) => x.data); }
  createProfile(displayName: string, relationshipType: "FAMILY" | "FRIEND" | "COLLEAGUE" | "OTHER") {
    if (PROTOTYPE_MODE) return prototypeResult({ ...prototypeProfiles[1], displayName, relationshipType });
    return this.command<Schemas["LifeProfileEnvelope"]>("/me/life-profiles", {
      method: "POST", body: JSON.stringify({ displayName, relationshipType, groupId: null }),
    }).then((x) => x.data);
  }
  updateProfile(profileId: string, displayName: string, relationshipType: "FAMILY" | "FRIEND" | "COLLEAGUE" | "OTHER") {
    if (PROTOTYPE_MODE) return prototypeResult({ ...(prototypeProfiles.find((item) => item.profileId === profileId) ?? prototypeProfiles[1]), displayName, relationshipType });
    return this.command<Schemas["LifeProfileEnvelope"]>(`/me/life-profiles/${profileId}`, {
      method: "PATCH", body: JSON.stringify({ displayName, relationshipType }),
    }).then((x) => x.data);
  }
  previewOtherProfile(profileId: string, birthInput: BirthInput) {
    if (PROTOTYPE_MODE) return prototypeResult({ ...prototypeRevision, revisionId: `${profileId}-revision` });
    return this.command<Schemas["ProfileRevisionEnvelope"]>(`/me/life-profiles/${profileId}/revisions/preview`, {
      method: "POST", body: JSON.stringify({ birthInput }),
    }).then((x) => x.data);
  }
  confirmOtherProfile(profileId: string, revisionId: string, fingerprint: string, enhancedConfirmationAccepted: boolean) {
    if (PROTOTYPE_MODE) return prototypeResult({ ...prototypeRevision, revisionId, status: "ACTIVE" as const });
    return this.command<Schemas["ProfileRevisionEnvelope"]>(`/me/life-profiles/${profileId}/revisions/${revisionId}/confirm`, {
      method: "POST", body: JSON.stringify({ fingerprint, enhancedConfirmationAccepted }),
    }).then((x) => x.data);
  }
  deleteProfile(profileId: string) {
    if (PROTOTYPE_MODE) return prototypeResult({ profileId });
    return this.command<{ data: unknown }>(`/me/life-profiles/${profileId}`, { method: "DELETE" }).then((x) => x.data);
  }
  profileGroups() { return PROTOTYPE_MODE ? prototypeResult([] as ProfileGroup[]) : this.request<Schemas["ProfileGroupListEnvelope"]>("/me/life-profile-groups").then((x) => x.data); }

  serviceOfferings() {
    return this.request<Schemas["ServiceOfferingListEnvelope"]>("/service-offerings?context=STORE").then((x) => x.data);
  }

  serviceOffering(offeringId: string) {
    return this.request<Schemas["ServiceOfferingEnvelope"]>(`/service-offerings/${encodeURIComponent(offeringId)}`).then((x) => x.data);
  }

  membershipPlans() {
    return this.request<Schemas["MembershipPlanListEnvelope"]>("/membership-plans").then((x) => x.data);
  }

  createCheckoutQuote(offeringId: string, businessContext?: BusinessContext | null) {
    return this.command<Schemas["CheckoutQuoteEnvelope"]>("/checkout-quotes", {
      method: "POST",
      body: JSON.stringify({ offeringId, businessContext: businessContext ?? null }),
    }).then((x) => x.data);
  }

  createMoneyOrder(quoteId: string) {
    return this.command<Schemas["MoneyOrderEnvelope"]>("/money-orders", {
      method: "POST",
      body: JSON.stringify({ quoteId }),
    }).then((x) => x.data);
  }

  moneyOrders() {
    return this.request<Schemas["MoneyOrderListEnvelope"]>("/money-orders?limit=50").then((x) => x.data);
  }

  moneyOrder(orderId: string) {
    return this.request<Schemas["MoneyOrderEnvelope"]>(`/money-orders/${encodeURIComponent(orderId)}`).then((x) => x.data);
  }

  cancelMoneyOrder(orderId: string) {
    return this.command<Schemas["MoneyOrderEnvelope"]>(`/money-orders/${encodeURIComponent(orderId)}/cancel`, { method: "POST" }).then((x) => x.data);
  }

  prepareWechatPaymentPayer(returnPath: string) {
    return this.command<Schemas["WechatPayerPreparationEnvelope"]>("/payment-payer/wechat/prepare", {
      method: "POST",
      body: JSON.stringify({ returnPath }),
    }).then((x) => x.data);
  }

  createPaymentAttempt(orderId: string, payerTicket?: string, requestKey?: string) {
    return this.command<Schemas["PaymentAttemptEnvelope"]>(`/money-orders/${encodeURIComponent(orderId)}/payment-attempts`, {
      method: "POST",
      ...(requestKey ? { headers: { "Idempotency-Key": requestKey } } : {}),
      body: JSON.stringify({ ...(payerTicket ? { payerTicket } : {}) }),
    }).then((x) => x.data);
  }

  paymentAttempt(paymentAttemptId: string) {
    return this.request<Schemas["PaymentAttemptEnvelope"]>(`/payment-attempts/${encodeURIComponent(paymentAttemptId)}`).then((x) => x.data);
  }

  entitlements() {
    return this.request<Schemas["EntitlementListEnvelope"]>("/me/entitlements?limit=50").then((x) => x.data);
  }

  usageRecords() {
    return this.request<Schemas["UsageRecordListEnvelope"]>("/me/usage-records?limit=50").then((x) => x.data);
  }

  resolveEntitlement(serviceType: "DAILY_ENERGY" | "CARD_READING", quantity: number, businessContext: BusinessContext, cardCount?: number) {
    return this.command<Schemas["EntitlementResolutionEnvelope"]>("/entitlement-resolutions", {
      method: "POST",
      body: JSON.stringify({ serviceType, quantity, businessContext, ...(cardCount ? { cardCount } : {}) }),
    }).then((x) => x.data);
  }

  createConsumptionIntent(resolutionId: string) {
    return this.command<Schemas["ConsumptionIntentEnvelope"]>("/consumption-intents", {
      method: "POST",
      body: JSON.stringify({ resolutionId }),
    }).then((x) => x.data);
  }

  startConsumptionIntent(intentId: string) {
    return this.command<Schemas["ConsumptionIntentEnvelope"]>(`/consumption-intents/${encodeURIComponent(intentId)}/start`, { method: "POST" }).then((x) => x.data);
  }

  currentMembership() {
    return this.request<{ data: MembershipSubscription | null }>("/memberships/current").then((x) => x.data);
  }

  membershipPeriods() {
    return this.request<{ data: Schemas["MembershipPeriod"][] }>("/memberships/periods").then((x) => x.data);
  }

  previewMembershipUpgrade(previousSubscriptionId: string, targetPlanVersionId: string) {
    return this.command<{ data: { previousSubscriptionId: string; targetPlanVersionId: string; payableAmount: Schemas["Money"]; confirmation: string } }>("/membership-upgrades/preview", {
      method: "POST",
      body: JSON.stringify({ previousSubscriptionId, targetPlanVersionId }),
    }).then((x) => x.data);
  }

  registerMembershipUpgrade(input: { previousSubscriptionId: string; targetPlanVersionId: string; newOrderId: string }) {
    return this.command<{ data: { upgradeId: string; status: string; confirmation: string } }>("/membership-upgrades", {
      method: "POST",
      body: JSON.stringify({ ...input, confirmationAccepted: true }),
    }).then((x) => x.data);
  }

  refundQuote(orderId: string) {
    return this.command<{ data: RefundQuote & { eligible?: boolean } }>("/refund-quotes", {
      method: "POST",
      body: JSON.stringify({ orderId }),
    }).then((x) => x.data);
  }

  requestRefund(orderId: string) {
    return this.command<{ data: Refund }>("/refunds", {
      method: "POST",
      body: JSON.stringify({ orderId }),
    }).then((x) => x.data);
  }

  refunds() {
    return this.request<Schemas["RefundListEnvelope"]>("/refunds").then((x) => x.data);
  }

  createCardReadingDraw(input: { question: string; category: string; cardCount: number; positionLabels: string[] }) {
    return this.command<{ data: CardReading }>("/card-readings/draws", { method: "POST", body: JSON.stringify({ ...input, drawMethod: "SYSTEM_RANDOM" }) }).then((x) => x.data);
  }
  cardReadings(cursor?: string) {
    return this.request<{ data: { items: CardReading[]; nextCursor: string | null } }>(`/card-readings?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`).then((x) => x.data);
  }
  cardReading(readingId: string) {
    return this.request<{ data: CardReading }>(`/card-readings/${encodeURIComponent(readingId)}`).then((x) => x.data);
  }
  completeCardReading(readingId: string) {
    return this.command<{ data: CardReading }>(`/card-readings/${encodeURIComponent(readingId)}/complete`, { method: "POST" }).then((x) => x.data);
  }
  retryCardReading(readingId: string) {
    return this.command<{ data: CardReading }>(`/card-readings/${encodeURIComponent(readingId)}/retry`, { method: "POST" }).then((x) => x.data);
  }
}

export const api = new SatoriApiClient();
