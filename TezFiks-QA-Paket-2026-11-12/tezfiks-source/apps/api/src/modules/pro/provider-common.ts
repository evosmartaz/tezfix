import { gridDisk, latLngToCell } from 'h3-js';
import { startOfBakuDay } from '@tezfiks/shared';

/** KYC: at most this many submissions per subject within KYC_WINDOW_MS (spec 6.5). */
export const KYC_MAX_SUBMISSIONS = 3;
export const KYC_WINDOW_MS = 24 * 60 * 60_000;
/** KYC images are purged this long after the admin decision (spec 12). */
export const KYC_RETENTION_MS = 30 * 24 * 60 * 60_000;
/** Average H3 res-7 edge-to-edge distance used to size service areas (km per ring). */
export const KM_PER_RING_RES7 = 2.44;
/** Company invite tokens: 18 random bytes = 24 url-safe characters. */
export const INVITE_TOKEN_BYTES = 18;

/** H3 res-7 cell of a point. */
export function cell7Of(lat: number, lng: number): string {
  return latLngToCell(lat, lng, 7);
}

/** Service area of a provider: every res-7 cell within ceil(radius / 2.44) rings of the base cell. */
export function serviceCellsFor(lat: number, lng: number, radiusKm: number): string[] {
  return gridDisk(cell7Of(lat, lng), Math.ceil(radiusKm / KM_PER_RING_RES7));
}

/** [start, end) of the Baku-local day containing `at`. */
export function bakuDayRange(at: Date): { start: Date; end: Date } {
  const start = startOfBakuDay(at);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60_000) };
}

/** "First Last" with missing parts dropped. */
export function fullName(first: string | null | undefined, last: string | null | undefined): string {
  return [first ?? '', last ?? ''].map((s) => s.trim()).filter(Boolean).join(' ');
}

/** Digits a phone search may match: "050 123 45 67" -> "501234567", "+994 50 ..." -> "99450...". Null when not phone-like. */
export function phoneSearchDigits(q: string): string | null {
  const compact = q.replace(/[\s()+-]/g, '');
  if (!/^\d{3,}$/.test(compact)) return null;
  return compact.startsWith('0') ? compact.slice(1) : compact;
}
