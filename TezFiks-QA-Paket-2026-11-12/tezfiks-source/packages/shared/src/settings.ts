import { z } from 'zod';

/** Platform settings (spec section 4). Money in qəpik, durations as named. Editable by admins. */
export const PlatformSettingsSchema = z.object({
  requestFee: z.int().min(0),
  emergencyFeePerSlot: z.int().min(0),
  cancelPenalty: z.int().min(0),
  penaltyCompensation: z.int().min(0),
  b2bFeePerWorkerDay: z.int().min(0),
  freeCancelSec: z.int().min(0),
  offerTtlSec: z.int().min(5),
  ringStepSec: z.int().min(3),
  emergencyRingStepSec: z.int().min(3),
  noMatchAfterSec: z.int().min(10),
  minCandidates: z.int().min(0),
  maxOffersPerStep: z.int().min(1),
  contactUnlockEtaSec: z.int().min(0),
  scheduledMinLeadMin: z.int().min(0),
  scheduledMaxLeadDays: z.int().min(1),
  scheduledLiveDispatchLeadMin: z.int().min(0),
  scheduledUnfilledLeadMin: z.int().min(0),
  scheduledOfferWindowMin: z.int().min(1),
  autoCompleteAfterMin: z.int().min(1),
  noShowAfterMin: z.int().min(1),
  guaranteeDays: z.int().min(0),
  guaranteeOriginalProviderMin: z.int().min(0),
  quoteWindowHours: z.number().min(0.01),
  vatRatePercent: z.number().min(0).max(100),
  maxSlots: z.int().min(1).max(50),
  maxPhotos: z.int().min(0).max(10),
  lowBalanceThreshold: z.int().min(0),
  chatOpenAfterTerminalMin: z.int().min(0),
  onlineStaleSec: z.int().min(10),
  /** "Arrived" needs the pro's fresh server-side position within this many metres of the address (outside the demo). */
  arrivalMaxDistanceM: z.int().min(50),
});
export type PlatformSettings = z.infer<typeof PlatformSettingsSchema>;

export const DEFAULT_SETTINGS: PlatformSettings = {
  requestFee: 1000,
  emergencyFeePerSlot: 500,
  cancelPenalty: 1500,
  penaltyCompensation: 1000,
  b2bFeePerWorkerDay: 1000,
  freeCancelSec: 300,
  offerTtlSec: 30,
  ringStepSec: 30,
  emergencyRingStepSec: 20,
  noMatchAfterSec: 180,
  minCandidates: 3,
  maxOffersPerStep: 10,
  contactUnlockEtaSec: 300,
  scheduledMinLeadMin: 30,
  scheduledMaxLeadDays: 30,
  scheduledLiveDispatchLeadMin: 90,
  scheduledUnfilledLeadMin: 15,
  scheduledOfferWindowMin: 60,
  autoCompleteAfterMin: 1440,
  noShowAfterMin: 45,
  guaranteeDays: 14,
  guaranteeOriginalProviderMin: 10,
  quoteWindowHours: 24,
  vatRatePercent: 18,
  maxSlots: 10,
  maxPhotos: 5,
  lowBalanceThreshold: 1000,
  chatOpenAfterTerminalMin: 120,
  onlineStaleSec: 90,
  arrivalMaxDistanceM: 500,
};

/** Overrides applied when the API runs with DEMO_MODE=true (fast timers for a live demo). */
export const DEMO_SETTINGS_OVERRIDES: Partial<PlatformSettings> = {
  offerTtlSec: 15,
  ringStepSec: 10,
  emergencyRingStepSec: 8,
  noMatchAfterSec: 90,
  scheduledMinLeadMin: 2,
  scheduledLiveDispatchLeadMin: 1,
  scheduledUnfilledLeadMin: 0,
  scheduledOfferWindowMin: 1,
  autoCompleteAfterMin: 10,
  noShowAfterMin: 5,
  quoteWindowHours: 0.1,
};

export function resolveSettings(stored: Partial<PlatformSettings>, demoMode: boolean): PlatformSettings {
  return { ...DEFAULT_SETTINGS, ...(demoMode ? DEMO_SETTINGS_OVERRIDES : {}), ...stored };
}
