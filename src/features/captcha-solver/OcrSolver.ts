/**
 * Method A — native OCR solver using tesseract.js, two-stage pipeline.
 *
 * Stage 1 (targetReader.ts): crop the top instruction band -> OCR -> regex
 *   out the target number (e.g. "343"). Skipped if a target is passed in.
 * Stage 2 (this file): crop the grid region -> split into cells -> OCR each
 *   cell -> normalize digits -> match against the target.
 *
 * Regions are configurable (fractions of the image) so the same solver works
 * on the full screenshot. The OpenAI solver is unaffected.
 */
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';
import {
  DEFAULT_GRID,
  centerOf,
  regionToBox,
  splitRegionIntoCells,
} from '../../core/grid.js';
import { digitsOnly, isMatch } from '../../core/text.js';
import { otsuThreshold } from '../../core/otsu.js';
import type {
  Cell,
  CaptchaSolution,
  CellBox,
  FractionalRegion,
  Solver,
  SolveInput,
} from '../../core/types.js';
import { readTargetNumber, type ReadTargetOptions } from './targetReader.js';

/** How much to upscale each cell crop before OCR — small digits read far better enlarged. */
const UPSCALE = 4;

/**
 * Default grid region for the captcha layout: the middle band of the window,
 * below the instruction text and above the buttons. Fractions of the image.
 */
export const DEFAULT_GRID_REGION: FractionalRegion = {
  left: 0.08,
  top: 0.24,
  width: 0.84,
  height: 0.52,
};

export interface OcrSolverOptions {
  /** Where the 3x3 grid sits within the image. */
  gridRegion?: FractionalRegion;
  /** Stage-1 target-reading config (instruction band, expected digits). */
  target?: ReadTargetOptions;
}

/**
 * Preprocess a single cell crop to give Tesseract its best chance:
 * grayscale -> upscale -> normalize contrast -> binarize (threshold).
 * Captchas are noisy/colored; OCR wants big, high-contrast black-on-white.
 */
export async function preprocessCell(image: Buffer, box: CellBox): Promise<Buffer> {
  // The digits are COLORED on a pale, near-neutral background. A FIXED grayscale
  // threshold can't capture both near-black and bright-yellow digits at once.
  // So we compute a PER-CELL Otsu threshold from this cell's own histogram,
  // which adapts to whatever color the digit is.
  //
  // Crop inward to skip the rounded tile border/edges, which otherwise skew
  // the per-cell histogram. Keep the central ~76% where the digit lives.
  const inset = 0.12;
  const ix = box.x + Math.round(box.width * inset);
  const iy = box.y + Math.round(box.height * inset);
  const iw = Math.max(1, box.width - 2 * Math.round(box.width * inset));
  const ih = Math.max(1, box.height - 2 * Math.round(box.height * inset));

  const gray = sharp(image)
    .extract({ left: ix, top: iy, width: iw, height: ih })
    .resize({ width: iw * UPSCALE, height: ih * UPSCALE, fit: 'fill' })
    .median(3) // suppress the dotted background texture before thresholding
    .grayscale();

  // Raw single-channel pixels -> compute the adaptive threshold.
  const { data, info } = await gray.clone().raw().toBuffer({ resolveWithObject: true });
  const threshold = otsuThreshold(data);

  // The digit occupies a SMALL fraction of the cell; the background is the
  // majority. So whichever Otsu class is the minority IS the digit. Count how
  // many pixels fall below the threshold: if the dark side is the majority, the
  // digit is actually the BRIGHT side, so we must invert to get black-on-white.
  let below = 0;
  for (let i = 0; i < data.length; i++) if (data[i]! < threshold) below++;
  const digitIsBrightClass = below > data.length / 2;

  let pipeline = sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  }).threshold(threshold);
  if (!digitIsBrightClass) {
    // Dark digit -> threshold already makes it black-on-white. Good.
  } else {
    // Bright digit on darker background -> flip so the digit ends up black.
    pipeline = pipeline.negate();
  }
  // Clean isolated speckles (median), then thicken strokes slightly so broken
  // glyphs reconnect — blur + re-threshold acts as a light morphological close,
  // which fixes digits Tesseract was dropping (e.g. reading "43" instead of
  // "343").
  const binarized = await sharp(await pipeline.png().toBuffer())
    .median(5)
    .toBuffer();

  // Trim surrounding whitespace to the digit's bounding box, then pad evenly.
  // Centering the glyph with generous margins is what Tesseract expects.
  // Declare a DPI (density) so Tesseract scales the glyph correctly — without
  // it, it warns "Invalid resolution" and can miss digits.
  const pad = { top: 40, bottom: 40, left: 40, right: 40, background: { r: 255, g: 255, b: 255 } };
  return sharp(binarized)
    .trim({ threshold: 10 })
    .extend(pad)
    .withMetadata({ density: 150 })
    .png()
    .toBuffer()
    .catch(() =>
      // trim() throws if the image is all one color (blank cell) — fall back.
      sharp(binarized).extend(pad).withMetadata({ density: 150 }).png().toBuffer(),
    );
}

/**
 * Pick the best digit read from several OCR attempts. Prefer a read whose
 * length equals the target's (most likely the correct full number); otherwise
 * take the most common read, breaking ties by length.
 */
export function pickBestRead(reads: string[], targetLen: number): string {
  const nonEmpty = reads.filter((r) => r.length > 0);
  if (nonEmpty.length === 0) return '';

  const exact = nonEmpty.filter((r) => r.length === targetLen);
  const pool = exact.length > 0 ? exact : nonEmpty;

  // Vote by frequency, tie-break by longer string.
  const counts = new Map<string, number>();
  for (const r of pool) counts.set(r, (counts.get(r) ?? 0) + 1);

  let best = pool[0]!;
  let bestScore = -1;
  for (const [value, count] of counts) {
    const score = count * 100 + value.length;
    if (score > bestScore) {
      bestScore = score;
      best = value;
    }
  }
  return best;
}

export class OcrSolver implements Solver {
  readonly name = 'ocr' as const;
  private readonly gridRegion: FractionalRegion;
  private readonly targetOpts?: ReadTargetOptions;

  constructor(opts: OcrSolverOptions = {}) {
    this.gridRegion = opts.gridRegion ?? DEFAULT_GRID_REGION;
    this.targetOpts = opts.target;
  }

  async solve(input: SolveInput): Promise<CaptchaSolution> {
    const grid = input.grid ?? DEFAULT_GRID;

    const meta = await sharp(input.image).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) {
      throw new Error('Could not read image dimensions.');
    }

    // Stage 1 — target number. Use the passed-in value, else read it.
    const target = input.targetNumber ?? (await readTargetNumber(input.image, this.targetOpts));

    // Stage 2 — locate the grid region and split into cells.
    const regionBox = regionToBox(this.gridRegion, width, height);
    const boxes = splitRegionIntoCells(regionBox, grid);

    // Different page-seg modes read different cells; no single one wins on all.
    // We OCR each cell under several modes and VOTE: prefer a read whose length
    // matches the target's, else the longest digit string seen.
    const PSM_MODES = [PSM.SINGLE_BLOCK, PSM.SINGLE_LINE, PSM.SINGLE_WORD];
    const targetLen = digitsOnly(target).length;

    const worker = await createWorker('eng');
    try {
      await worker.setParameters({ tessedit_char_whitelist: '0123456789' });

      const cells: Cell[] = [];
      for (let index = 0; index < boxes.length; index++) {
        const box = boxes[index]!;
        const cropped = await preprocessCell(input.image, box);

        const reads: string[] = [];
        for (const psm of PSM_MODES) {
          await worker.setParameters({ tessedit_pageseg_mode: psm });
          const { data } = await worker.recognize(cropped);
          reads.push(digitsOnly(data.text));
        }
        const value = pickBestRead(reads, targetLen);

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
