'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { panelTiles } from './tiles';
import type { PanelMapProps } from './types';

function MapLoading() {
  const t = useTranslations('panel.map');
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted text-sm text-muted-foreground">
      {t('loading')}
    </div>
  );
}

const LeafletMap = dynamic(() => import('./leaflet-map'), { ssr: false, loading: MapLoading });
const GoogleMap = dynamic(() => import('./google-map'), { ssr: false, loading: MapLoading });

/**
 * Live map for the panels (admin Xəritə, company dispatch). Base map, first match wins: Mapbox tiles via Leaflet when
 * NEXT_PUBLIC_MAPBOX_TOKEN is set, Google Maps when a browser key is configured, otherwise OpenStreetMap tiles via
 * Leaflet so maps work without any key.
 */
export function PanelMap({ className, ...props }: PanelMapProps) {
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
  const googleKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? '';
  return (
    <div className={cn('relative h-96 w-full overflow-hidden rounded-lg border border-border', className)}>
      {googleKey && !mapboxToken ? (
        <GoogleMap apiKey={googleKey} {...props} />
      ) : (
        <LeafletMap {...props} tiles={panelTiles(mapboxToken, process.env.NEXT_PUBLIC_MAPBOX_STYLE)} />
      )}
    </div>
  );
}

export * from './types';
