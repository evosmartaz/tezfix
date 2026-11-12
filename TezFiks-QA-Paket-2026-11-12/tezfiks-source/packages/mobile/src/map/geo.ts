import { cellToBoundary, cellToLatLng } from 'h3-js';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface MapRegion extends LatLng {
  latitudeDelta: number;
  longitudeDelta: number;
}

/** Baku city centre (default camera). */
export const BAKU_REGION: MapRegion = { latitude: 40.4093, longitude: 49.8671, latitudeDelta: 0.12, longitudeDelta: 0.12 };

/** OpenStreetMap raster tiles used when the build has no Google Maps key (emulator/dev). */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Polygon vertices of an H3 cell for react-native-maps (h3-js returns [lat, lng] pairs). */
export function hexagonCoordinates(cell: string): LatLng[] {
  return cellToBoundary(cell).map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
}

export function cellCenter(cell: string): LatLng {
  const [latitude, longitude] = cellToLatLng(cell);
  return { latitude, longitude };
}

/** Region that fits all points with padding (factor 1.4); falls back to Baku. */
export function regionForPoints(points: LatLng[], minDelta = 0.01): MapRegion {
  if (points.length === 0) return BAKU_REGION;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLng = Math.min(minLng, p.longitude);
    maxLng = Math.max(maxLng, p.longitude);
  }
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(minDelta, (maxLat - minLat) * 1.4),
    longitudeDelta: Math.max(minDelta, (maxLng - minLng) * 1.4),
  };
}
