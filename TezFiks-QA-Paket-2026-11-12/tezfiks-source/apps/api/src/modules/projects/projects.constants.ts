import type { ProjectStatus } from '@tezfiks/shared';

/** Job names (lane B4). Handlers are idempotent: they re-read the project and do nothing when it moved on. */
export const PROJECT_JOB = {
  /** At quoteDeadline: a project without any submitted quote becomes EXPIRED. */
  quoteDeadline: 'projects.quoteDeadline',
  /** At quoteDeadline + AWARD_WINDOW_MS: an OPEN project whose customer chose no quote expires and its quote holds are released. */
  awardExpiry: 'projects.awardExpiry',
} as const;

export const projectJobId = {
  quoteDeadline: (projectId: string) => `project-deadline-${projectId}`,
  awardExpiry: (projectId: string) => `project-award-expiry-${projectId}`,
};

/** Reconciler task: expires overdue OPEN projects (missed timers, restarts). */
export const PROJECT_RECONCILER_TASK = 'projects.repair';

/**
 * How long the customer may still choose a quote after the quote window closed. The spec has no setting for this; without a limit
 * the providers' fee holds could stay reserved forever. After it, the project is EXPIRED and the quotes are EXPIRED (holds released).
 */
export const AWARD_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** Longest allowed project date span (inclusive days). */
export const MAX_PROJECT_DAYS = 366;

export const ACTIVE_PROJECT_STATUSES: readonly ProjectStatus[] = ['OPEN', 'AWARDED', 'IN_PROGRESS', 'COMPLETED', 'INVOICED'];
export const HISTORY_PROJECT_STATUSES: readonly ProjectStatus[] = ['PAID', 'CANCELLED', 'EXPIRED'];
/** Statuses in which the awarded provider works on the project (reports, completion). */
export const EXECUTION_STATUSES: readonly ProjectStatus[] = ['AWARDED', 'IN_PROGRESS'];
/** The customer may rate the provider once the work is completed. */
export const RATEABLE_STATUSES: readonly ProjectStatus[] = ['COMPLETED', 'INVOICED', 'PAID'];

const DAY_MS = 24 * 60 * 60_000;

/** "2026-11-01" -> Date at UTC midnight (the value Prisma stores in a @db.Date column). */
export function dateOnly(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** Date column -> "2026-11-01". */
export function isoDateOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Inclusive number of calendar days between two ISO dates ("2026-11-01".."2026-11-03" = 3). */
export function workDaysBetween(from: string, to: string): number {
  return Math.round((dateOnly(to).getTime() - dateOnly(from).getTime()) / DAY_MS) + 1;
}

/** Invoice number "TF-2026-000123". */
export function invoiceNumber(year: number, seq: number | bigint): string {
  return `TF-${year}-${String(seq).padStart(6, '0')}`;
}
