/** Raster base layer of the Leaflet map: OpenStreetMap, or Mapbox when the panel build has a Mapbox token. */
export interface TileLayerConfig {
  url: string;
  attribution: string;
  maxZoom: number;
  tileSize?: number;
  zoomOffset?: number;
}

/** Mapbox style of the tiles unless NEXT_PUBLIC_MAPBOX_STYLE names another (e.g. a Mapbox Studio style). */
export const MAPBOX_DEFAULT_STYLE = 'mapbox/streets-v12';

export const OSM_TILES: TileLayerConfig = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
};

/**
 * Mapbox Static Tiles API for Leaflet: 512 px tiles with zoomOffset -1, so one billed request covers what four 256 px
 * tiles would; Leaflet turns `{r}` into "@2x" on high-density screens.
 */
export function mapboxTiles(token: string, style: string = MAPBOX_DEFAULT_STYLE): TileLayerConfig {
  return {
    url: `https://api.mapbox.com/styles/v1/${style}/tiles/512/{z}/{x}/{y}{r}?access_token=${encodeURIComponent(token)}`,
    attribution:
      '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
      '<strong><a href="https://www.mapbox.com/map-feedback/" target="_blank" rel="noopener noreferrer">Improve this map</a></strong>',
    maxZoom: 22,
    tileSize: 512,
    zoomOffset: -1,
  };
}

/** Mapbox tiles when a token is configured (NEXT_PUBLIC_MAPBOX_TOKEN), otherwise OpenStreetMap. */
export function panelTiles(token?: string | null, style?: string | null): TileLayerConfig {
  const t = token?.trim();
  return t ? mapboxTiles(t, style?.trim() || MAPBOX_DEFAULT_STYLE) : OSM_TILES;
}
