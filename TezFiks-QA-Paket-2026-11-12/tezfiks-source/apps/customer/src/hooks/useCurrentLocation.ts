import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { ensureLocationPermission, type PermissionResult } from '@tezfiks/mobile';

export interface Coords {
  lat: number;
  lng: number;
}

export interface CurrentLocationState {
  coords: Coords | null;
  permission: PermissionResult | null;
  loading: boolean;
  /** Asks for permission (if needed) and reads the position again. */
  refresh: () => Promise<Coords | null>;
}

/**
 * Reads the device position once (foreground permission only). A last known fix answers fast; a fresh fix follows
 * when there was none. Never throws: failures leave `coords` null.
 */
export async function readPosition(): Promise<Coords | null> {
  try {
    const last = await Location.getLastKnownPositionAsync?.({ maxAge: 5 * 60_000 });
    if (last?.coords) return { lat: last.coords.latitude, lng: last.coords.longitude };
  } catch {
    // fall through to a fresh fix
  }
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy?.Balanced ?? 3 });
    return pos?.coords ? { lat: pos.coords.latitude, lng: pos.coords.longitude } : null;
  } catch {
    return null;
  }
}

export function useCurrentLocation(opts: { auto?: boolean } = {}): CurrentLocationState {
  const auto = opts.auto ?? true;
  const [coords, setCoords] = useState<Coords | null>(null);
  const [permission, setPermission] = useState<PermissionResult | null>(null);
  const [loading, setLoading] = useState(auto);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const perm = await ensureLocationPermission();
    if (!alive.current) return null;
    setPermission(perm);
    const pos = perm === 'granted' ? await readPosition() : null;
    if (!alive.current) return pos;
    if (pos) setCoords(pos);
    setLoading(false);
    return pos;
  }, []);

  useEffect(() => {
    if (auto) void refresh();
  }, [auto, refresh]);

  return { coords, permission, loading, refresh };
}
