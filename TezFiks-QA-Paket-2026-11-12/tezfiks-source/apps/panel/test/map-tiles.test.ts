import { describe, expect, it } from 'vitest';
import { MAPBOX_DEFAULT_STYLE, OSM_TILES, mapboxTiles, panelTiles } from '@/components/map/tiles';

describe('panel map tiles', () => {
  it('uses OpenStreetMap tiles without a Mapbox token', () => {
    expect(panelTiles(undefined)).toBe(OSM_TILES);
    expect(panelTiles('   ')).toBe(OSM_TILES);
    expect(OSM_TILES.url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  });

  it('uses Mapbox 512 px tiles (zoomOffset -1, retina suffix) with the Mapbox attribution when a token is set', () => {
    const tiles = panelTiles(' pk.test-token ');
    expect(tiles.url).toBe('https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/{z}/{x}/{y}{r}?access_token=pk.test-token');
    expect(tiles).toMatchObject({ tileSize: 512, zoomOffset: -1, maxZoom: 22 });
    expect(tiles.attribution).toContain('https://www.mapbox.com/about/maps/');
    expect(tiles.attribution).toContain('https://www.openstreetmap.org/copyright');
    expect(tiles.attribution).toContain('https://www.mapbox.com/map-feedback/');
  });

  it('honours a Mapbox Studio style and encodes the token', () => {
    expect(panelTiles('pk.x', 'evosmart/brand-v2').url).toContain('/styles/v1/evosmart/brand-v2/tiles/512/');
    expect(panelTiles('pk.x', ' ').url).toContain(`/styles/v1/${MAPBOX_DEFAULT_STYLE}/tiles/512/`);
    expect(mapboxTiles('pk.a&b').url).toContain('access_token=pk.a%26b');
  });
});
