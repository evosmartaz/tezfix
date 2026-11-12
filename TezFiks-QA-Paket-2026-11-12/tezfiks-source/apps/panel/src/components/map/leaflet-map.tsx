'use client';

import 'leaflet/dist/leaflet.css';
import { CircleMarker, MapContainer, Polygon, TileLayer, Tooltip, useMapEvents } from 'react-leaflet';
import { BAKU_CENTER, DEFAULT_ZOOM, MARKER_COLOR, POLYGON_COLOR, type MapPoint, type PanelMapProps } from './types';

function ClickHandler({ onMapClick }: { onMapClick: (point: MapPoint) => void }) {
  useMapEvents({ click: (e) => onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/** OpenStreetMap fallback used when no Google Maps browser key is configured (development, demo). */
export default function LeafletMap({
  center = BAKU_CENTER,
  zoom = DEFAULT_ZOOM,
  markers = [],
  polygons = [],
  onMarkerClick,
  onMapClick,
}: PanelMapProps) {
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={zoom} scrollWheelZoom className="h-full w-full">
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
      />
      {onMapClick ? <ClickHandler onMapClick={onMapClick} /> : null}
      {polygons.map((p) => (
        <Polygon
          key={p.id}
          positions={p.points.map((pt) => [pt.lat, pt.lng] as [number, number])}
          pathOptions={{ color: p.color ?? POLYGON_COLOR, weight: 1, fillOpacity: p.fillOpacity ?? 0.2 }}
        />
      ))}
      {markers.map((m) => (
        <CircleMarker
          key={m.id}
          center={[m.lat, m.lng]}
          radius={7}
          pathOptions={{ color: '#ffffff', weight: 2, fillColor: m.color ?? MARKER_COLOR, fillOpacity: 1 }}
          eventHandlers={onMarkerClick ? { click: () => onMarkerClick(m.id) } : undefined}
        >
          {m.label ? <Tooltip>{m.label}</Tooltip> : null}
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
