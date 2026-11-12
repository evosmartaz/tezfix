import { cellToBoundary, isValidCell } from 'h3-js';

/** H3 cell -> [lat, lng] ring (h3-js); throws for an invalid cell so the mapper skips it. */
export function cellBoundary(cell: string): Array<[number, number]> {
  if (!isValidCell(cell)) throw new Error(`invalid H3 cell ${cell}`);
  return cellToBoundary(cell) as Array<[number, number]>;
}
