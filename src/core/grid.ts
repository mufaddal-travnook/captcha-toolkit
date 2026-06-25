/**
 * Grid geometry helpers — pure functions, no image/OCR dependency.
 *
 * This is where the "where to click" logic lives. The AI/OCR only reads
 * numbers; this module turns a cell index into a pixel box/center so the
 * future clicker knows exactly where to tap.
 */
import type { CellBox, FractionalRegion, Grid, Point } from './types.js';

export const DEFAULT_GRID: Grid = { rows: 3, cols: 3 };

/**
 * Convert a fractional region (0..1) to an integer pixel box, clamped to the
 * image bounds. Used to crop the instruction band and the grid area.
 */
export function regionToBox(
  region: FractionalRegion,
  imageWidth: number,
  imageHeight: number,
): CellBox {
  const x = Math.max(0, Math.floor(region.left * imageWidth));
  const y = Math.max(0, Math.floor(region.top * imageHeight));
  const width = Math.min(imageWidth - x, Math.round(region.width * imageWidth));
  const height = Math.min(imageHeight - y, Math.round(region.height * imageHeight));
  return { x, y, width, height };
}

/** Total number of cells in a grid. */
export function cellCount(grid: Grid): number {
  return grid.rows * grid.cols;
}

/** Convert a flat index to row/col coordinates. */
export function indexToRowCol(index: number, grid: Grid): { row: number; col: number } {
  return {
    row: Math.floor(index / grid.cols),
    col: index % grid.cols,
  };
}

/**
 * Split an image of the given pixel size into evenly-sized cell boxes.
 * Returns boxes in flat order (left-to-right, top-to-bottom).
 */
export function splitIntoCells(
  imageWidth: number,
  imageHeight: number,
  grid: Grid = DEFAULT_GRID,
): CellBox[] {
  const cellWidth = Math.floor(imageWidth / grid.cols);
  const cellHeight = Math.floor(imageHeight / grid.rows);

  const boxes: CellBox[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      boxes.push({
        x: col * cellWidth,
        y: row * cellHeight,
        width: cellWidth,
        height: cellHeight,
      });
    }
  }
  return boxes;
}

/**
 * Split a pixel region (e.g. the detected grid area) into evenly-sized cell
 * boxes with ABSOLUTE coordinates in the source image. Unlike
 * `splitIntoCells`, this respects the region's x/y offset, so the resulting
 * `center` points land on the real tiles in the full screenshot.
 */
export function splitRegionIntoCells(region: CellBox, grid: Grid = DEFAULT_GRID): CellBox[] {
  const cellWidth = Math.floor(region.width / grid.cols);
  const cellHeight = Math.floor(region.height / grid.rows);

  const boxes: CellBox[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      boxes.push({
        x: region.x + col * cellWidth,
        y: region.y + row * cellHeight,
        width: cellWidth,
        height: cellHeight,
      });
    }
  }
  return boxes;
}

/** Pixel center of a cell box — the point the clicker should click. */
export function centerOf(box: CellBox): Point {
  return {
    x: box.x + Math.floor(box.width / 2),
    y: box.y + Math.floor(box.height / 2),
  };
}
