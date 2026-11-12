import { startOfBakuDay } from '@tezfiks/shared';
import { ApiException } from '../../common/http/api-exception';
import { decodeCursor, encodeCursor } from '../../common/mapping';

export { fullName, phoneSearchDigits } from '../pro/provider-common';

export const DEFAULT_LIMIT = 20;
export const DAY_MS = 86_400_000;

/** Builds a parameterised WHERE clause for raw list queries. */
export class SqlWhere {
  readonly params: unknown[] = [];
  readonly conds: string[] = [];

  p(v: unknown): string {
    this.params.push(v);
    return `$${this.params.length}`;
  }

  add(cond: string): void {
    this.conds.push(cond);
  }

  get sql(): string {
    return this.conds.length ? `WHERE ${this.conds.join(' AND ')}` : '';
  }
}

/** Keyset cursor of admin lists: (timestamp, id) of the last row, newest first. */
export interface TimeCursor {
  c: string;
  i: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decodes a list cursor; a malformed or crafted one is VALIDATION_FAILED, never a database error. */
export function decodeTimeCursor(raw: string | undefined): TimeCursor | null {
  if (!raw) return null;
  const cur = decodeCursor<Partial<TimeCursor>>(raw);
  const ok =
    !!cur &&
    typeof cur.c === 'string' &&
    typeof cur.i === 'string' &&
    UUID_RE.test(cur.i) &&
    /^\d{4}-\d{2}-\d{2}T/.test(cur.c) &&
    !Number.isNaN(Date.parse(cur.c));
  if (!ok) throw new ApiException('VALIDATION_FAILED', { field: 'cursor' });
  return cur as TimeCursor;
}

export function encodeTimeCursor(at: Date | string, id: string): string {
  return encodeCursor({ c: typeof at === 'string' ? at : at.toISOString(), i: id } satisfies TimeCursor);
}

/** "#2847", "№2847", "2847" -> 2847 (request / project numbers); null when the query is not a number. */
export function numberQuery(q: string): number | null {
  const m = /^\s*[#№]?\s*(\d{1,9})\s*$/.exec(q);
  return m ? Number(m[1]) : null;
}

/** Start of the Baku-local day containing `at`, and `days` days later / earlier. */
export function bakuDay(at: Date, days = 0): Date {
  return new Date(startOfBakuDay(at).getTime() + days * DAY_MS);
}

/**
 * SQL predicate: the request is a bot / demo request (created by the demo tools, or served by a bot handyman).
 * Bot requests are flagged in lists and left out of dashboard KPIs.
 */
export function botRequestSql(alias = 'r'): string {
  return `(${alias}."isDemo" OR EXISTS (SELECT 1 FROM assignments ba JOIN handyman_profiles bh ON bh.id = ba."handymanId" WHERE ba."requestId" = ${alias}.id AND bh."isBot"))`;
}

/** Rounds to `digits` decimals (dashboard ratios and percentages). */
export function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
