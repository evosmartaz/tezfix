import { cellToBoundary, gridDistance, isValidCell, latLngToCell } from 'h3-js';

/** Dispatch resolution (spec 5: DISPATCH_RES = 7). */
export const DISPATCH_RES = 7;

export interface MapPoint {
  latitude: number;
  longitude: number;
}

export interface MapRegionLike extends MapPoint {
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface HexRing {
  /** Grid distance from the request cell (0 = the request's own cell). */
  ring: number;
  cells: string[];
}

export function requestCell(lat: number, lng: number): string {
  return latLngToCell(lat, lng, DISPATCH_RES);
}

/** Valid, de-duplicated cells in first-seen order. */
export function cleanCells(cells: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cells) {
    if (typeof c !== 'string' || seen.has(c)) continue;
    let ok = false;
    try {
      ok = isValidCell(c);
    } catch {
      ok = false;
    }
    if (!ok) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/** Union of the cells shown so far and a new `request:search` payload (payloads carry the cells covered so far). */
export function mergeCells(prev: readonly string[], next: readonly string[]): string[] {
  return cleanCells([...prev, ...next]);
}

/**
 * Groups covered cells into rings around the request cell for the pulsing animation (board 02 B4).
 * Cells whose grid distance cannot be computed (pentagon distortion, different base cells) go to the outermost ring.
 */
export function groupByRing(cells: readonly string[], center: string | null): HexRing[] {
  const clean = cleanCells(cells);
  if (clean.length === 0) return [];
  const byRing = new Map<number, string[]>();
  const unknown: string[] = [];
  for (const c of clean) {
    let d: number | null = null;
    if (center) {
      try {
        d = gridDistance(center, c);
      } catch {
        d = null;
      }
    }
    if (d === null || d < 0) unknown.push(c);
    else byRing.set(d, [...(byRing.get(d) ?? []), c]);
  }
  const rings = [...byRing.entries()].sort((a, b) => a[0] - b[0]).map(([ring, list]) => ({ ring, cells: list }));
  if (unknown.length) {
    const last = rings.length ? rings[rings.length - 1].ring + 1 : 0;
    rings.push({ ring: last, cells: unknown });
  }
  return rings;
}

/** Polygon vertices of a cell for react-native-maps (h3-js gives [lat, lng]). */
export function cellPolygon(cell: string): MapPoint[] {
  return cellToBoundary(cell).map(([latitude, longitude]) => ({ latitude, longitude }));
}

/** Camera region that fits every covered cell (with padding), or null when there are none. */
export function regionForCells(cells: readonly string[], padding = 1.3, minDelta = 0.02): MapRegionLike | null {
  const clean = cleanCells(cells);
  if (!clean.length) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const c of clean) {
    for (const p of cellPolygon(c)) {
      minLat = Math.min(minLat, p.latitude);
      maxLat = Math.max(maxLat, p.latitude);
      minLng = Math.min(minLng, p.longitude);
      maxLng = Math.max(maxLng, p.longitude);
    }
  }
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(minDelta, (maxLat - minLat) * padding),
    longitudeDelta: Math.max(minDelta, (maxLng - minLng) * padding),
  };
}

/** Triangle wave 0 → 1 → 0 over `periodMs` (pulse driver). */
export function pulsePhase(tMs: number, periodMs = 1600): number {
  if (periodMs <= 0) return 0;
  const x = (((tMs % periodMs) + periodMs) % periodMs) / periodMs;
  return x < 0.5 ? x * 2 : (1 - x) * 2;
}

/**
 * Fill opacity of a ring: the newest (outermost) ring pulses between 0.15 and 0.45; older rings stay as a faint
 * trail that fades with age (never below 0.06).
 */
export function ringOpacity(ring: number, newestRing: number, phase: number): number {
  const p = Math.min(1, Math.max(0, phase));
  if (ring >= newestRing) return round2(0.15 + 0.3 * p);
  const age = newestRing - ring;
  return round2(Math.max(0.06, 0.22 - age * 0.04));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** rgba() of the brand blue (#2F5BFF) with the given alpha. */
export function brandFill(alpha: number): string {
  return `rgba(47, 91, 255, ${alpha})`;
}
