/**
 * Satori R1 的非敏感、版本化运行策略。
 *
 * 这些值属于产品、安全或可靠性规则，而不是部署环境差异。修改它们必须经过代码审查、
 * 自动化测试和正常发版，避免不同服务器通过 `.env` 静默产生行为漂移。
 */
export const R1_RUNTIME_POLICY = {
  /** 对外暴露的配置版本；客户端和运维可用它确认当前规则版本。 */
  version: 'r1.0-2026-08-26.1',

  auth: {
    /** Access Token 有效期（秒）；影响新签发 Token 的过期时间。 */
    accessTokenTtlSeconds: 1_800,
    /** Refresh Token 与 Session 有效期（秒）；影响新 Session 和 Refresh Cookie。 */
    refreshTokenTtlSeconds: 2_592_000,
    /** 短信验证码有效期（秒）；影响新创建的验证码挑战。 */
    otpTtlSeconds: 300,
    /** 同一验证码挑战允许再次发送前的等待时间（秒）。 */
    otpResendSeconds: 60,
    /** 单个验证码挑战允许的最大错误尝试次数。 */
    otpMaxAttempts: 5,
    rateLimitsPerHour: {
      /** 单一手机号每小时允许申请验证码的次数。 */
      phone: 5,
      /** 单一设备每小时允许申请验证码的次数。 */
      device: 10,
      /** 单一 IP 每小时允许申请验证码的次数。 */
      ip: 20,
    },
  },

  idempotency: {
    /** 幂等结果保留时间（秒）；影响登录、档案、生成、反馈和注销等写操作。 */
    ttlSeconds: 604_800,
  },

  queue: {
    /** 生成任务最大尝试次数；同时作为 BullMQ 和数据库任务的默认重试预算。 */
    maxAttempts: 5,
    /** 队列任务与 Outbox 重投的指数退避基础时间（毫秒）。 */
    backoffMs: 2_000,
  },

  aqua: {
    dailyInsight: {
      /** 完整每日指引固定调用的 Aqua Workflow；所有环境保持一致。 */
      workflowId: 'daily-insight',
    },
    homeEnergySummary: {
      /** 首页能量摘要固定调用的 Aqua Workflow。 */
      workflowId: 'daily-energy-home-summary',
      /** 首页摘要缓存与请求使用的固定 Workflow 版本。 */
      workflowVersion: 'daily-energy-home-summary/1.0.3',
      /** 单次首页摘要 Aqua 请求超时（毫秒）。 */
      requestTimeoutMs: 15_000,
      /** 首页摘要遇到可重试错误时的最大尝试次数。 */
      maxAttempts: 2,
      /** 首页摘要重试的基础退避时间（毫秒）。 */
      retryBackoffMs: 250,
      prewarm: {
        /** 每轮预生成的自然日数量。 */
        days: 3,
        /** 同时发起的 Aqua 摘要请求数量。 */
        concurrency: 3,
        /** 相邻预热请求的最小间隔（毫秒）。 */
        spacingMs: 5_000,
        /** 两轮预热任务之间的间隔（毫秒）。 */
        intervalMs: 3_600_000,
      },
    },
  },

  profile: {
    /** 档案预览结果有效期（秒）；过期后必须重新生成预览。 */
    previewTtlSeconds: 86_400,
    /** PROFILE-11 生成记录超过该时长（毫秒）仍未完成时，可由后续请求接管恢复。 */
    firstLookStaleAfterMs: 330_000,
  },

  dailyInsight: {
    /** 每日指引历史查询窗口（天）。 */
    historyDays: 90,
    /**
     * 每次每日指引消耗的智慧种子数量。
     * 在数据库保存价格快照前不得直接修改；预留、消费、释放、退款和接口显示必须使用同一值。
     */
    price: 1,
  },

  registration: {
    /** 新用户注册后创建的待领取智慧种子奖励数量；已创建奖励会在数据库保存实际金额。 */
    rewardAmount: 18,
  },

  accountDeletion: {
    /** 新建账号注销申请的可撤销冷静期（小时）；申请创建后会保存具体执行时间。 */
    cancellationHours: 168,
  },
} as const;

export type RuntimePolicy = typeof R1_RUNTIME_POLICY;
