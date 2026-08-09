/**
 * R1.1 proposed contract. The current backend document explicitly reserves
 * /card-draws and /card-readings for a later release, so these calls are wired
 * behind the frontend adapter until the backend implements the endpoints.
 */
export const CARD_READING_CONTRACT_STATUS = "CONTRACT_PROPOSED" as const;

export type CardReadingCategory = "CAREER" | "ROMANTIC" | "FINANCE_LIFE" | "WELLBEING" | "CHOICE" | "SELF_GROWTH";
export type CardReadingStatus = "DRAFT" | "DRAWN" | "GENERATING" | "READY" | "FAILED";

export interface CreateCardDrawRequest {
  question: string;
  category: CardReadingCategory;
  cardCount: 1 | 2 | 3 | 4 | 5;
  deckCode: "RELATIONSHIP_WISDOM_DEFAULT";
  drawMethod: "SYSTEM_RANDOM";
  positionLabels: string[];
}

export interface DrawnCard {
  position: number;
  positionLabel: string;
  cardCode: string;
  displayName: string;
}

export interface CardDraw {
  drawId: string;
  status: "DRAWN";
  cards: DrawnCard[];
  frozenAt: string;
}

export interface CreateCardReadingRequest {
  drawId: string;
  audience: "CONSUMER";
  settlement: { currency: "WISDOM_SEED"; amount: number };
}

export interface CardReadingTask {
  readingId: string;
  taskId: string;
  status: CardReadingStatus;
  settlementStatus: "RESERVED" | "CONSUMED" | "RELEASED" | "REFUNDED";
}

export interface CardReadingReport {
  readingId: string;
  question: string;
  category: CardReadingCategory;
  status: "READY";
  cards: DrawnCard[];
  sections: Array<{ code: "OPENING" | "SELF" | "CARDS" | "ACTION" | "CLOSING"; title: string; body: string }>;
  createdAt: string;
}

const API_BASE = "/api/v1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), ...init?.headers },
  });
  if (!response.ok) throw new Error(`CARD_READING_API_${response.status}`);
  return response.json() as Promise<T>;
}

export const cardReadingApi = {
  createRandomDraw: (payload: CreateCardDrawRequest) => request<CardDraw>("/card-draws", { method: "POST", body: JSON.stringify(payload) }),
  createReading: (payload: CreateCardReadingRequest) => request<CardReadingTask>("/card-readings", { method: "POST", body: JSON.stringify(payload) }),
  getReading: (readingId: string) => request<CardReadingReport>(`/card-readings/${readingId}`),
  listReadings: (cursor?: string) => request<{ items: CardReadingReport[]; nextCursor: string | null }>(`/card-readings${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  retryReading: (readingId: string) => request<CardReadingTask>(`/card-readings/${readingId}/retry`, { method: "POST" }),
  submitFeedback: (readingId: string, value: "CLEARER" | "INSPIRED" | "NEEDS_TIME" | "NOT_HELPFUL") => request<void>(`/card-readings/${readingId}/feedback`, { method: "POST", body: JSON.stringify({ value }) }),
};
