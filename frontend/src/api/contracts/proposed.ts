export interface WisdomSeedAccount {
  accountId: string;
  available: number;
  reserved: number;
  totalEarned: number;
  totalSpent: number;
  updatedAt: string;
}

export type WisdomSeedTransactionType =
  | "GRANT"
  | "RESERVE"
  | "CONSUME"
  | "RELEASE"
  | "REFUND"
  | "ADJUSTMENT";

export interface WisdomSeedTransaction {
  transactionId: string;
  type: WisdomSeedTransactionType;
  amount: number;
  balanceAfter: number;
  title: string;
  relatedResource?: { type: string; id: string };
  createdAt: string;
}

export interface RegistrationReward {
  rewardId: string;
  status: "AVAILABLE" | "CLAIMED" | "EXPIRED";
  wisdomSeedAmount: number;
  claimedAt: string | null;
}

export interface LifeProfileListItem {
  profileId: string;
  subjectType: "SELF" | "OTHER";
  displayName: string;
  relationshipType: "SELF" | "FAMILY" | "FRIEND" | "COLLEAGUE" | "OTHER";
  groupId: string | null;
  currentRevisionId: string;
  updatedAt: string;
}

export interface SeedSettlement {
  currency: "WISDOM_SEED";
  amount: number;
  status: "RESERVED" | "CONSUMED" | "RELEASED" | "REFUNDED";
  transactionId: string;
}

