export type ApiSupportStatus =
  | "BACKEND_READY"
  | "CONTRACT_FROZEN"
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
  profileLibrary: { capability: "生命智慧档案库", status: "BACKEND_READY", blocksRelease: true, note: "多人档案与分组接口已实现" },
  registrationReward: { capability: "新用户智慧种子赠送", status: "BACKEND_READY", blocksRelease: true, note: "幂等奖励领取接口已实现" },
  wisdomSeeds: { capability: "智慧种子账户及流水", status: "BACKEND_READY", blocksRelease: true, note: "账户、流水、预占、核销和退回已实现" },
  dailyInsight: { capability: "每日指引", status: "BACKEND_READY", blocksRelease: true, note: "生成任务与智慧种子结算已实现" },
} satisfies Record<string, ApiContractMeta>;
