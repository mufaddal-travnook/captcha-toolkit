/**
 * Grid geometry helpers — pure functions, no image/OCR dependency.
 *
 * This is where the "where to click" logic lives. The AI/OCR only reads
 * numbers; this module turns a cell index into a pixel box/center so the
 * future clicker knows exactly where to tap.
 */
import type { CellBox, Grid, Point } from './types.js';

export const DEFAULT_GRID: Grid = { rows: 3, cols: 3 };

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

/** Pixel center of a cell box — the point the clicker should click. */
export function centerOf(box: CellBox): Point {
  return {
    x: box.x + Math.floor(box.width / 2),
    y: box.y + Math.floor(box.height / 2),
  };
}
