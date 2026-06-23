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
import { createWorker, PSM } from 'tesseract.js';
import { DEFAULT_GRID, centerOf, splitIntoCells } from '../../core/grid.js';
import { digitsOnly, isMatch } from '../../core/text.js';
import type { Cell, CaptchaSolution, Solver, SolveInput } from '../../core/types.js';

/** How much to upscale each cell crop before OCR — small digits read far better enlarged. */
const UPSCALE = 3;

/**
 * Preprocess a single cell crop to give Tesseract its best chance:
 * grayscale -> upscale -> normalize contrast -> binarize (threshold).
 * Captchas are noisy/colored; OCR wants big, high-contrast black-on-white.
 */
async function preprocessCell(
  image: Buffer,
  box: { x: number; y: number; width: number; height: number },
): Promise<Buffer> {
  return sharp(image)
    .extract({ left: box.x, top: box.y, width: box.width, height: box.height })
    .grayscale()
    .resize({ width: box.width * UPSCALE, height: box.height * UPSCALE, fit: 'fill' })
    .normalize()
    .threshold(140) // binarize: drop background texture, keep the strokes
    .toBuffer();
}

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
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789',
        // Treat each cell as a single line of text, not a page/paragraph.
        // This stops the "Line cannot be recognized" failures on small crops.
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
      });

      const cells: Cell[] = [];
      for (let index = 0; index < boxes.length; index++) {
        const box = boxes[index]!;
        const cropped = await preprocessCell(input.image, box);

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
