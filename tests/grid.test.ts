import { describe, expect, it } from 'vitest';
import { splitIntoCells, centerOf, indexToRowCol, cellCount } from '../src/core/grid.js';

describe('grid geometry', () => {
  it('splits a 300x300 image into 9 even cells', () => {
    const boxes = splitIntoCells(300, 300, { rows: 3, cols: 3 });
    expect(boxes).toHaveLength(9);
    expect(boxes[0]).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(boxes[8]).toEqual({ x: 200, y: 200, width: 100, height: 100 });
  });

  it('computes the pixel center of a cell', () => {
    expect(centerOf({ x: 0, y: 0, width: 100, height: 100 })).toEqual({ x: 50, y: 50 });
    expect(centerOf({ x: 200, y: 200, width: 100, height: 100 })).toEqual({ x: 250, y: 250 });
  });

  it('maps flat index to row/col', () => {
    expect(indexToRowCol(0, { rows: 3, cols: 3 })).toEqual({ row: 0, col: 0 });
    expect(indexToRowCol(5, { rows: 3, cols: 3 })).toEqual({ row: 1, col: 2 });
    expect(indexToRowCol(8, { rows: 3, cols: 3 })).toEqual({ row: 2, col: 2 });
  });

  it('counts cells', () => {
    expect(cellCount({ rows: 3, cols: 3 })).toBe(9);
    expect(cellCount({ rows: 2, cols: 4 })).toBe(8);
  });
});
