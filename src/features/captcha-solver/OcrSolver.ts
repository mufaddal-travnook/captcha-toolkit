/**
 * Method A — native OCR solver using tesseract.js.
 *
 * Flow:
 *   1. Read image dimensions.
 *   2. Split into cell boxes (core/grid).
 *   3. Crop each cell with sharp.
 *   4. OCR each cell -> read its digits.
 *   5. Mark matches vs the target number.
 */
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { DEFAULT_GRID, centerOf, splitIntoCells } from '../../core/grid.js';
import { digitsOnly, isMatch } from '../../core/text.js';
import type { Cell, CaptchaSolution, Solver, SolveInput } from '../../core/types.js';

export class OcrSolver implements Solver {
  readonly name = 'ocr' as const;

  async solve(input: SolveInput): Promise<CaptchaSolution> {
    const grid = input.grid ?? DEFAULT_GRID;
    const target = input.targetNumber;
    if (!target) {
      throw new Error('OcrSolver requires `targetNumber` — OCR cannot infer the prompt.');
    }

    const meta = await sharp(input.image).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) {
      throw new Error('Could not read image dimensions.');
    }

    const boxes = splitIntoCells(width, height, grid);
    const worker = await createWorker('eng');
    try {
      await worker.setParameters({ tessedit_char_whitelist: '0123456789' });

      const cells: Cell[] = [];
      for (let index = 0; index < boxes.length; index++) {
        const box = boxes[index]!;
        const cropped = await sharp(input.image)
          .extract({ left: box.x, top: box.y, width: box.width, height: box.height })
          .grayscale()
          .normalize()
          .toBuffer();

        const { data } = await worker.recognize(cropped);
        const value = digitsOnly(data.text);

        cells.push({
          index,
          row: Math.floor(index / grid.cols),
          col: index % grid.cols,
          value,
          match: isMatch(value, target),
          box,
          center: centerOf(box),
        });
      }

      return {
        targetNumber: target,
        grid,
        cells,
        matches: cells.filter((c) => c.match).map((c) => c.index),
        solver: this.name,
      };
    } finally {
      await worker.terminate();
    }
  }
}
