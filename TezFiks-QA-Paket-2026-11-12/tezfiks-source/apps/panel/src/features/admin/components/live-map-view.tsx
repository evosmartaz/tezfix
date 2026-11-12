'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { DateTime } from '@/components/date-time';
import { PanelMap } from '@/components/map/panel-map';
import { Button } from '@/components/ui/button';
import { useRealtime, useSocketEvent } from '@/lib/realtime/realtime-provider';
import { liveMapAction } from '../actions';
import { cellBoundary } from '../h3';
import { liveMapLayers, MAP_COLORS, markerHref } from '../mappers';
import type { LiveMap } from '../types';

export const LIVE_MAP_REFRESH_MS = 10_000;

/** Xəritə: handymen (online / busy / bot / offline) and searching requests with their H3 rings; refreshes every 10 s and on admin events. */
export function LiveMapView({ initial }: { initial: LiveMap }) {
  const t = useTranslations('panel.admin.map');
  const router = useRouter();
  const { connected } = useRealtime();
  const [map, setMap] = useState<LiveMap>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const r = await liveMapAction();
      if (r.ok) {
        setMap(r.data);
        setError(null);
      } else setError(r.message);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') void reload();
    }, LIVE_MAP_REFRESH_MS);
    return () => clearInterval(id);
  }, [reload]);

  useSocketEvent('admin:event', () => {
    if (debounce.current) return;
    debounce.current = setTimeout(() => {
      debounce.current = null;
      void reload();
    }, 1000);
  });

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  const layers = useMemo(() => liveMapLayers(map, cellBoundary), [map]);
  const legend: Array<{ key: keyof typeof MAP_COLORS; count: number }> = [
    { key: 'online', count: layers.counts.online },
    { key: 'busy', count: layers.counts.busy },
    { key: 'bot', count: layers.counts.bot },
    { key: 'offline', count: layers.counts.offline },
    { key: 'request', count: layers.counts.requests },
    { key: 'searching', count: layers.counts.searching },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label={t('legend')}>
          {legend.map((l) => (
            <li key={l.key} className="flex items-center gap-1.5" data-legend={l.key}>
              <span
                className={l.key === 'searching' ? 'size-3 rounded-sm opacity-60' : 'size-3 rounded-full'}
                style={{ backgroundColor: MAP_COLORS[l.key] }}
              />
              {t(`legendItems.${l.key}`)}: <span className="font-semibold tabular-nums">{l.count}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {t('updated')} <DateTime value={map.serverNow} mode="time" />
          </span>
          <span className={connected ? 'text-primary' : ''}>{connected ? t('live') : t('polling')}</span>
          <Button size="sm" variant="outline" onClick={() => void reload()} loading={loading}>
            <RefreshCw />
            {t('refresh')}
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
      <PanelMap
        className="h-[calc(100dvh-14rem)] min-h-96"
        markers={layers.markers}
        polygons={layers.polygons}
        onMarkerClick={(id) => {
          const href = markerHref(id);
          if (href) router.push(href);
        }}
      />
    </div>
  );
}
