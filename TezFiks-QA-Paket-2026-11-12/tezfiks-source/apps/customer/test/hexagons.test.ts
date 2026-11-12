import { gridDisk, gridRing, latLngToCell } from 'h3-js';
import {
  DISPATCH_RES,
  brandFill,
  cellPolygon,
  cleanCells,
  groupByRing,
  mergeCells,
  pulsePhase,
  regionForCells,
  requestCell,
  ringOpacity,
} from '../src/lib/hexagons';

const center = latLngToCell(40.4093, 49.8671, 7);

describe('hexagon geometry for the searching screen', () => {
  it('uses the dispatch resolution 7 for the request cell', () => {
    expect(DISPATCH_RES).toBe(7);
    expect(requestCell(40.4093, 49.8671)).toBe(center);
    expect(center).toMatch(/^[0-9a-f]{15}$/);
  });

  it('groups covered cells by ring distance from the request cell', () => {
    const cells = [...gridRing(center, 2), center, ...gridRing(center, 1)];
    const rings = groupByRing(cells, center);
    expect(rings.map((r) => r.ring)).toEqual([0, 1, 2]);
    expect(rings[0].cells).toEqual([center]);
    expect(rings[1].cells).toHaveLength(6);
    expect(rings[2].cells).toHaveLength(12);
  });

  it('emergency step 0 (k<=1 disk) arrives as one payload and still splits into rings 0 and 1', () => {
    const rings = groupByRing(gridDisk(center, 1), center);
    expect(rings.map((r) => [r.ring, r.cells.length])).toEqual([
      [0, 1],
      [1, 6],
    ]);
  });

  it('without a center cell everything lands in one ring', () => {
    expect(groupByRing(gridDisk(center, 1), null)).toEqual([{ ring: 0, cells: gridDisk(center, 1) }]);
    expect(groupByRing([], center)).toEqual([]);
  });

  it('drops invalid and duplicate cells, and merges payloads keeping first-seen order', () => {
    expect(cleanCells([center, 'zzz', center, '', 'ffffffffffffffff'])).toEqual([center]);
    const r1 = gridRing(center, 1);
    expect(mergeCells([center], [center, ...r1])).toEqual([center, ...r1]);
    expect(mergeCells([center, ...r1], [center])).toEqual([center, ...r1]);
  });

  it('cell polygons are hexagons around the cell (6 vertices, near Baku)', () => {
    const poly = cellPolygon(center);
    expect(poly).toHaveLength(6);
    for (const p of poly) {
      expect(Math.abs(p.latitude - 40.4093)).toBeLessThan(0.05);
      expect(Math.abs(p.longitude - 49.8671)).toBeLessThan(0.05);
    }
  });

  it('the camera region covers every cell with padding', () => {
    expect(regionForCells([])).toBeNull();
    const cells = gridDisk(center, 2);
    const region = regionForCells(cells)!;
    for (const c of cells) {
      for (const p of cellPolygon(c)) {
        expect(Math.abs(p.latitude - region.latitude)).toBeLessThanOrEqual(region.latitudeDelta / 2);
        expect(Math.abs(p.longitude - region.longitude)).toBeLessThanOrEqual(region.longitudeDelta / 2);
      }
    }
    expect(regionForCells([center], 1.3, 0.5)!.latitudeDelta).toBe(0.5);
  });

  it('pulse: a triangle wave 0→1→0 over the period', () => {
    expect(pulsePhase(0, 1000)).toBe(0);
    expect(pulsePhase(250, 1000)).toBe(0.5);
    expect(pulsePhase(500, 1000)).toBe(1);
    expect(pulsePhase(750, 1000)).toBe(0.5);
    expect(pulsePhase(1000, 1000)).toBe(0);
    expect(pulsePhase(-250, 1000)).toBe(0.5);
    expect(pulsePhase(123, 0)).toBe(0);
  });

  it('the newest ring pulses, older rings fade with age but stay visible', () => {
    expect(ringOpacity(3, 3, 0)).toBe(0.15);
    expect(ringOpacity(3, 3, 1)).toBe(0.45);
    expect(ringOpacity(3, 3, 7)).toBe(0.45);
    expect(ringOpacity(2, 3, 1)).toBe(0.18);
    expect(ringOpacity(1, 3, 0.3)).toBe(0.14);
    expect(ringOpacity(0, 10, 1)).toBe(0.06);
    expect(brandFill(0.25)).toBe('rgba(0, 169, 113, 0.25)');
  });
});
