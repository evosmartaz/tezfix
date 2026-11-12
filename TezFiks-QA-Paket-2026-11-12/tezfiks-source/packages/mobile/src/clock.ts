import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

/**
 * Server clock correction. The server is authoritative for every timer: payloads carry `serverNow`,
 * and countdowns render `deadline - (clientNow + offset)`.
 */
export interface ClockState {
  /** serverNow - clientNow, in milliseconds. */
  offsetMs: number;
  /** Updates the offset from a server timestamp received at `receivedAt` (client ms). Ignores invalid input. */
  syncWithServer: (serverNow: string | Date | number, receivedAt?: number) => void;
  reset: () => void;
}

export function computeClockOffset(serverNow: string | Date | number, receivedAt: number): number | null {
  const server = serverNow instanceof Date ? serverNow.getTime() : typeof serverNow === 'number' ? serverNow : Date.parse(serverNow);
  if (!Number.isFinite(server)) return null;
  return server - receivedAt;
}

export const clockStore = createStore<ClockState>((set) => ({
  offsetMs: 0,
  syncWithServer: (serverNow, receivedAt = Date.now()) => {
    const offset = computeClockOffset(serverNow, receivedAt);
    if (offset !== null) set({ offsetMs: offset });
  },
  reset: () => set({ offsetMs: 0 }),
}));

export function useClockOffset(): number {
  return useStore(clockStore, (s) => s.offsetMs);
}

/** Server "now" estimate in client time. */
export function serverNow(now: number = Date.now()): number {
  return now + clockStore.getState().offsetMs;
}
