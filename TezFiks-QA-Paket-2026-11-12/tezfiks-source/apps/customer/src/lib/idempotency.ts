import { isRetryableWithSameKey } from './requestErrors';

/**
 * One Idempotency-Key per pending action (cancel, confirm price, top-up, tip...). A retry after a connectivity
 * failure or a 5xx reuses the key, so a double tap or a lost response can never charge twice; a success or a business
 * error frees it, so the next deliberate attempt is a new operation.
 */
export interface KeyRegistry {
  get(action: string): string;
  settle(action: string, err?: unknown): void;
  peek(action: string): string | null;
}

export function createKeyRegistry(newKey: () => string): KeyRegistry {
  const keys = new Map<string, string>();
  return {
    get(action) {
      let k = keys.get(action);
      if (!k) {
        k = newKey();
        keys.set(action, k);
      }
      return k;
    },
    settle(action, err) {
      if (err === undefined || !isRetryableWithSameKey(err)) keys.delete(action);
    },
    peek(action) {
      return keys.get(action) ?? null;
    },
  };
}
