export interface MapPoint {
  lat: number;
  lng: number;
}

export interface MapMarker extends MapPoint {
  id: string;
  /** Tooltip text (never a phone number or exact address of a customer for company users). */
  label?: string;
  /** CSS colour of the dot. */
  color?: string;
}

/** Filled area (e.g. an H3 cell boundary for the dispatch rings). */
export interface MapPolygon {
  id: string;
  points: MapPoint[];
  color?: string;
  fillOpacity?: number;
}

export interface PanelMapProps {
  center?: MapPoint;
  zoom?: number;
  markers?: MapMarker[];
  polygons?: MapPolygon[];
  onMarkerClick?: (id: string) => void;
  /** Click on the map background (e.g. the admin demo page picks a point for a test request). */
  onMapClick?: (point: MapPoint) => void;
  className?: string;
}

/** Baku city centre. */
export const BAKU_CENTER: MapPoint = { lat: 40.4093, lng: 49.8671 };
export const DEFAULT_ZOOM = 12;
export const MARKER_COLOR = '#2F5BFF';
export const POLYGON_COLOR = '#F59E0B';
