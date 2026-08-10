import type { components } from "./contracts/generated";

type Schemas = components["schemas"];
type Bootstrap = Schemas["BootstrapEnvelope"]["data"];
type Session = Schemas["SessionEnvelope"]["data"];
type Me = Schemas["MeEnvelope"]["data"];
type HomeOverview = Schemas["HomeOverviewEnvelope"]["data"];
type Location = Schemas["Location"];
type ProfileRevision = Schemas["ProfileRevision"];
type ProfileConfirmation = Schemas["ProfileConfirmation"];
type RegistrationReward = Schemas["RegistrationReward"];
type WisdomSeedAccount = Schemas["WisdomSeedAccount"];
type WisdomSeedTransaction = Schemas["WisdomSeedTransaction"];
type DailyInsight = Schemas["DailyInsight"];
type GenerationTask = Schemas["GenerationTask"];
type LifeProfile = Schemas["LifeProfile"];
type ProfileGroup = Schemas["ProfileGroup"];

export type {
  Bootstrap,
  DailyInsight,
  GenerationTask,
  HomeOverview,
  LifeProfile,
  Location,
  Me,
  ProfileConfirmation,
  ProfileGroup,
  ProfileRevision,
  RegistrationReward,
  Session,
  WisdomSeedAccount,
  WisdomSeedTransaction,
};
export type BirthInput = Schemas["BirthInput"];

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
  }

  private async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
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
      throw new ApiError(
        failure?.message || `请求失败（HTTP ${response.status}）`,
        response.status,
        failure?.code,
        failure?.requestId,
      );
    }
    return payload as T;
  }

  private command<T>(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Idempotency-Key", idempotencyKey());
    return this.request<T>(path, { ...init, headers });
  }

  async refresh() {
    if (!this.refreshing) {
      this.refreshing = this.request<Schemas["RefreshSessionEnvelope"]>(
        "/auth/sessions/refresh",
        { method: "POST" },
        false,
      ).then(({ data }) => {
        this.accessToken = data.accessToken;
        return true;
      }).catch(() => {
        this.accessToken = null;
        return false;
      }).finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  bootstrap() {
    return this.request<Schemas["BootstrapEnvelope"]>("/app/bootstrap").then((x) => x.data);
  }

  sendSms(phone: string) {
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
    return this.command<Schemas["SessionEnvelope"]>("/auth/sessions", {
      method: "POST",
      body: JSON.stringify({ challengeId, verificationCode, consentAcceptances, device: getDevice() }),
    }).then(({ data }) => {
      this.accessToken = data.accessToken;
      return data;
    });
  }

  me() { return this.request<Schemas["MeEnvelope"]>("/me").then((x) => x.data); }
  home() { return this.request<Schemas["HomeOverviewEnvelope"]>("/me/home-overview").then((x) => x.data); }
  selfProfile() { return this.request<Schemas["LifeProfileEnvelope"]>("/me/life-profile").then((x) => x.data); }
  profileRevision(revisionId: string) {
    return this.request<Schemas["ProfileRevisionEnvelope"]>(`/me/life-profile/revisions/${revisionId}`).then((x) => x.data);
  }
  searchLocations(query: string) {
    return this.request<Schemas["LocationListEnvelope"]>(`/locations?query=${encodeURIComponent(query)}&limit=8`).then((x) => x.data);
  }
  previewProfile(birthInput: BirthInput) {
    return this.command<Schemas["ProfileRevisionEnvelope"]>("/me/life-profile/revisions/preview", {
      method: "POST", body: JSON.stringify({ birthInput }),
    }).then((x) => x.data);
  }
  confirmProfile(revisionId: string, fingerprint: string, enhancedConfirmationAccepted: boolean) {
    return this.command<Schemas["ProfileConfirmationEnvelope"]>(`/me/life-profile/revisions/${revisionId}/confirm`, {
      method: "POST", body: JSON.stringify({ fingerprint, enhancedConfirmationAccepted }),
    }).then((x) => x.data);
  }
  registrationReward() { return this.request<Schemas["RegistrationRewardEnvelope"]>("/me/registration-reward").then((x) => x.data); }
  claimRegistrationReward() {
    return this.command<Schemas["RegistrationRewardClaimEnvelope"]>("/me/registration-reward/claim", { method: "POST" }).then((x) => x.data);
  }
  seedAccount() { return this.request<Schemas["WisdomSeedAccountEnvelope"]>("/me/wisdom-seed-account").then((x) => x.data); }
  seedTransactions() { return this.request<Schemas["WisdomSeedTransactionListEnvelope"]>("/me/wisdom-seed-transactions?limit=50").then((x) => x.data); }
  createTodayInsight() {
    return this.command<Schemas["DailyInsightCommandEnvelope"]>("/daily-insights/today", { method: "POST" }).then((x) => x.data);
  }
  dailyInsight(localDate: string) {
    return this.request<Schemas["DailyInsightEnvelope"]>(`/daily-insights/${localDate}`).then((x) => x.data);
  }
  generationTask(taskId: string) {
    return this.request<Schemas["GenerationTaskEnvelope"]>(`/generation-tasks/${taskId}`).then((x) => x.data);
  }
  profiles() { return this.request<Schemas["LifeProfileListEnvelope"]>("/me/life-profiles?limit=50").then((x) => x.data); }
  createProfile(displayName: string, relationshipType: "FAMILY" | "FRIEND" | "COLLEAGUE" | "OTHER") {
    return this.command<Schemas["LifeProfileEnvelope"]>("/me/life-profiles", {
      method: "POST", body: JSON.stringify({ displayName, relationshipType, groupId: null }),
    }).then((x) => x.data);
  }
  previewOtherProfile(profileId: string, birthInput: BirthInput) {
    return this.command<Schemas["ProfileRevisionEnvelope"]>(`/me/life-profiles/${profileId}/revisions/preview`, {
      method: "POST", body: JSON.stringify({ birthInput }),
    }).then((x) => x.data);
  }
  confirmOtherProfile(profileId: string, revisionId: string, fingerprint: string, enhancedConfirmationAccepted: boolean) {
    return this.command<Schemas["ProfileRevisionEnvelope"]>(`/me/life-profiles/${profileId}/revisions/${revisionId}/confirm`, {
      method: "POST", body: JSON.stringify({ fingerprint, enhancedConfirmationAccepted }),
    }).then((x) => x.data);
  }
  deleteProfile(profileId: string) {
    return this.command<{ data: unknown }>(`/me/life-profiles/${profileId}`, { method: "DELETE" }).then((x) => x.data);
  }
  profileGroups() { return this.request<Schemas["ProfileGroupListEnvelope"]>("/me/life-profile-groups").then((x) => x.data); }
}

export const api = new SatoriApiClient();
