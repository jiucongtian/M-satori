export type ApiEnvelope<T> = { data: T };
export type ApiListEnvelope<T> = { data: T[]; meta: { nextCursor: string | null; hasMore: boolean } };
export type ApiErrorEnvelope = {
  error: { code: string; message: string; requestId: string; details?: unknown };
};

export * from './http/index.js';
