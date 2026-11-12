/** BigInt column -> JS number (amounts are far below 2^53). */
export function num(v: bigint | number | null | undefined): number {
  return v == null ? 0 : Number(v);
}

export function numOrNull(v: bigint | number | null | undefined): number | null {
  return v == null ? null : Number(v);
}

export function iso(d: Date): string;
export function iso(d: Date | null | undefined): string | null;
export function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/** ratingSum/ratingCount -> average rounded to one decimal, null when unrated. */
export function ratingAvg(sum: number, count: number): number | null {
  return count > 0 ? Math.round((sum / count) * 10) / 10 : null;
}

/** Cursor helpers: cursors are opaque base64url JSON. */
export function encodeCursor(v: unknown): string {
  return Buffer.from(JSON.stringify(v)).toString('base64url');
}

export function decodeCursor<T>(cursor: string | undefined): T | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

/** Page from rows fetched with take = limit + 1, using the row id as the cursor. */
export function pageOf<T extends { id: string }, V>(rows: T[], limit: number, mapFn: (row: T) => V): { items: V[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  return { items: slice.map(mapFn), nextCursor: hasMore ? slice[slice.length - 1]!.id : null };
}
