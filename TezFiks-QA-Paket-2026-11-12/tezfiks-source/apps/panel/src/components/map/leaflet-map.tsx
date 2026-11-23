'use client';

import 'leaflet/dist/leaflet.css';
import { CircleMarker, MapContainer, Polygon, TileLayer, Tooltip, useMapEvents } from 'react-leaflet';
import { OSM_TILES, type TileLayerConfig } from './tiles';
import { BAKU_CENTER, DEFAULT_ZOOM, MARKER_COLOR, POLYGON_COLOR, type MapPoint, type PanelMapProps } from './types';

function ClickHandler({ onMapClick }: { onMapClick: (point: MapPoint) => void }) {
  useMapEvents({ click: (e) => onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/** Leaflet map on raster tiles: Mapbox when the panel has a Mapbox token, otherwise OpenStreetMap (development, demo). */
export default function LeafletMap({
  center = BAKU_CENTER,
  zoom = DEFAULT_ZOOM,
  markers = [],
  polygons = [],
  onMarkerClick,
  onMapClick,
  tiles = OSM_TILES,
}: PanelMapProps & { tiles?: TileLayerConfig }) {
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={zoom} scrollWheelZoom className="h-full w-full">
      <TileLayer
        url={tiles.url}
        attribution={tiles.attribution}
        maxZoom={tiles.maxZoom}
        tileSize={tiles.tileSize ?? 256}
        zoomOffset={tiles.zoomOffset ?? 0}
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
