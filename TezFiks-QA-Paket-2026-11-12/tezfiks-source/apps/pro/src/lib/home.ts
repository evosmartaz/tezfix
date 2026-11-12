import type { ProProfile } from '@tezfiks/shared';

export interface TodayTiles {
  jobs: boolean;
  /** Hidden for workers of MANAGER-priced companies: their statsToday.earnings is always 0 (company money). */
  earnings: boolean;
  /** Platform fees are the solo handyman's own money only. */
  fees: boolean;
}

/** Which "Bu gün" tiles the home shows (board 03 B1: jobs, earnings, platform fees). */
export function todayTiles(profile: Pick<ProProfile, 'kind' | 'company'>): TodayTiles {
  if (profile.kind === 'SOLO') return { jobs: true, earnings: true, fees: true };
  return { jobs: true, earnings: profile.company?.finalPriceEntry === 'WORKER', fees: false };
}
