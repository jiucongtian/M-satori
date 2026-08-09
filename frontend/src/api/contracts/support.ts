export type ApiSupportStatus =
  | "BACKEND_READY"
  | "CONTRACT_PROPOSED"
  | "MOCK_ONLY";

export interface ApiContractMeta {
  capability: string;
  status: ApiSupportStatus;
  blocksRelease: boolean;
  note?: string;
}

export const apiSupportMatrix = {
  bootstrap: { capability: "应用初始化", status: "BACKEND_READY", blocksRelease: true },
  authentication: { capability: "手机号注册登录", status: "BACKEND_READY", blocksRelease: true },
  selfProfile: { capability: "本人生命智慧档案", status: "BACKEND_READY", blocksRelease: true },
  profileLibrary: { capability: "生命智慧档案库", status: "CONTRACT_PROPOSED", blocksRelease: true, note: "待后端实现多人档案与分组接口" },
  registrationReward: { capability: "新用户智慧种子赠送", status: "CONTRACT_PROPOSED", blocksRelease: true, note: "待后端实现幂等奖励领取接口" },
  wisdomSeeds: { capability: "智慧种子账户及流水", status: "CONTRACT_PROPOSED", blocksRelease: true, note: "待后端实现账户、流水、预占、核销和退回" },
  dailyInsight: { capability: "每日指引", status: "BACKEND_READY", blocksRelease: true, note: "待后端契约增加智慧种子结算字段" },
} satisfies Record<string, ApiContractMeta>;

