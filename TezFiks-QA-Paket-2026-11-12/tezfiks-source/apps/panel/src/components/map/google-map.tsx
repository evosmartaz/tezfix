'use client';

import { APIProvider, Map, Marker, Polygon } from '@vis.gl/react-google-maps';
import { BAKU_CENTER, DEFAULT_ZOOM, MARKER_COLOR, POLYGON_COLOR, type PanelMapProps } from './types';

function dotIcon(color: string): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 7,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 2,
  };
}

/** Google Maps (when NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY is set). */
export default function GoogleMap({
  apiKey,
  center = BAKU_CENTER,
  zoom = DEFAULT_ZOOM,
  markers = [],
  polygons = [],
  onMarkerClick,
  onMapClick,
}: PanelMapProps & { apiKey: string }) {
  return (
    <APIProvider apiKey={apiKey}>
      <Map
        defaultCenter={center}
        defaultZoom={zoom}
        gestureHandling="greedy"
        disableDefaultUI={false}
        className="h-full w-full"
        onClick={
          onMapClick
            ? (e) => {
                const ll = e.detail.latLng;
                if (ll) onMapClick({ lat: ll.lat, lng: ll.lng });
              }
            : undefined
        }
      >
        {polygons.map((p) => (
          <Polygon
            key={p.id}
            paths={[p.points]}
            strokeColor={p.color ?? POLYGON_COLOR}
            strokeWeight={1}
            fillColor={p.color ?? POLYGON_COLOR}
            fillOpacity={p.fillOpacity ?? 0.2}
          />
        ))}
        {markers.map((m) => (
          <Marker
            key={m.id}
            position={{ lat: m.lat, lng: m.lng }}
            title={m.label}
            icon={dotIcon(m.color ?? MARKER_COLOR)}
            onClick={onMarkerClick ? () => onMarkerClick(m.id) : undefined}
          />
        ))}
      </Map>
    </APIProvider>
  );
}
