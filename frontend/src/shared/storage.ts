const FLOW_PREFIX = "fresh:flow:";

export type StoredDraft<T> = {
  version: number;
  createdAt: number;
  expiresAt: number;
  ownerId: string;
  value: T;
};

export function readFlowDraft<T>(flow: string, ownerId: string, version: number): T | null {
  if (typeof window === "undefined") return null;
  const key = `${FLOW_PREFIX}${flow}`;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(key) ?? "null") as StoredDraft<T> | null;
    if (!parsed || parsed.version !== version || parsed.ownerId !== ownerId || parsed.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return parsed.value;
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
}

export function writeFlowDraft<T>(flow: string, ownerId: string, version: number, value: T, ttlMs = 30 * 60 * 1000) {
  if (typeof window === "undefined") return;
  const createdAt = Date.now();
  const draft: StoredDraft<T> = { version, createdAt, expiresAt: createdAt + ttlMs, ownerId, value };
  window.sessionStorage.setItem(`${FLOW_PREFIX}${flow}`, JSON.stringify(draft));
}

export function clearFlowDraft(flow: string) {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(`${FLOW_PREFIX}${flow}`);
}

export function clearAllFlowDrafts() {
  if (typeof window === "undefined") return;
  for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = window.sessionStorage.key(index);
    if (key?.startsWith(FLOW_PREFIX)) window.sessionStorage.removeItem(key);
  }
}
