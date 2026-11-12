import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { z } from 'zod';
import type { OtpRequestResponseSchema } from '@tezfiks/shared';

export type OtpChallenge = z.infer<typeof OtpRequestResponseSchema>;

export interface OtpFlowState {
  /** The pending login challenge (phone → OTP screens). */
  challenge: OtpChallenge | null;
  /** Client time (ms) when the resend becomes available. */
  resendAvailableAt: number;
  setChallenge(challenge: OtpChallenge, now?: number): void;
  clear(): void;
}

/** Shared between the phone and OTP screens of the login flow. */
export const otpFlowStore = createStore<OtpFlowState>((set) => ({
  challenge: null,
  resendAvailableAt: 0,
  setChallenge: (challenge, now = Date.now()) =>
    set({ challenge, resendAvailableAt: now + Math.max(0, challenge.resendAfterSec) * 1000 }),
  clear: () => set({ challenge: null, resendAvailableAt: 0 }),
}));

export function useOtpFlow<T>(selector: (s: OtpFlowState) => T): T {
  return useStore(otpFlowStore, selector);
}
