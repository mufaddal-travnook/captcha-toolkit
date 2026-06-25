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
import { createWorker, OEM, PSM } from 'tesseract.js';
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
  top: 0.18,
  width: 0.84,
  height: 0.56,
};

export interface OcrSolverOptions {
  /** Where the 3x3 grid sits within the image. */
  gridRegion?: FractionalRegion;
  /** Stage-1 target-reading config (instruction band, expected digits). */
  target?: ReadTargetOptions;
}

/** White (background) and black (ink) constants for the binary working image. */
const WHITE = 255;
const BLACK = 0;

/**
 * Binarize a grayscale cell using a per-cell Otsu threshold, always producing
 * BLACK digits on a WHITE background regardless of the digit's original color.
 *
 * Key idea: the digit is a MINORITY of pixels (strokes are sparse vs the tile
 * background). So after Otsu splits the histogram into two classes, whichever
 * class has FEWER pixels is the ink — we paint that class black, the rest white.
 * This removes any need to guess "is the digit dark or bright".
 */
function binarizeMinorityAsInk(gray: Uint8Array | Buffer, threshold: number): Buffer {
  let belowCount = 0;
  for (let i = 0; i < gray.length; i++) if (gray[i]! <= threshold) belowCount++;
  const aboveCount = gray.length - belowCount;
  // Minority class = ink. If fewer pixels are <= threshold, ink is the low side.
  const inkIsLow = belowCount <= aboveCount;

  const out = Buffer.allocUnsafe(gray.length);
  for (let i = 0; i < gray.length; i++) {
    const isLow = gray[i]! <= threshold;
    const isInk = inkIsLow ? isLow : !isLow;
    out[i] = isInk ? BLACK : WHITE;
  }
  return out;
}

/**
 * Morphological CLOSE on a black-on-white binary image: dilate ink then erode,
 * which reconnects broken/thin strokes without merging separate digits.
 * Implemented with a blur + threshold pair (cheap, dependency-free).
 */
async function closeStrokes(binaryPng: Buffer): Promise<Buffer> {
  // Input/output are BLACK ink on WHITE. Blurring spreads the black strokes
  // outward; thresholding at a HIGH cutoff keeps any pixel that picked up some
  // darkness, which thickens (dilates) the strokes and closes small gaps.
  // A single mild dilate is safer than a full close here — it reconnects thin
  // glyphs without the risk of merging adjacent digits.
  return sharp(binaryPng)
    .blur(1.2)
    .threshold(225) // reconnect thin/broken strokes; keep near-white as white
    .toBuffer();
}

/**
 * Remove an underline bar from a black-on-white binary cell. Captchas often
 * underline the digit; that wide horizontal ink run in the lower part of the
 * cell merges with the glyphs and corrupts OCR (e.g. "855" -> "899"/"85").
 *
 * Bars appear at the BOTTOM (underline) and sometimes the TOP (a sliver of the
 * clipped instruction line / tile edge caught in the top row). Both span most
 * of the width, unlike a digit stroke. We scan the top and bottom bands and
 * paint white from the cell edge up to / down to the bar — clearing the bar
 * and anything beyond it, while leaving the central digits untouched.
 */
async function removeHorizontalBars(binaryPng: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(binaryPng)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  // Per-row ink fraction across the full width.
  const rowInk = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y++) {
    let ink = 0;
    for (let x = 0; x < width; x++) {
      if (data[y * width + x]! < 128) ink++;
    }
    rowInk[y] = ink / width;
  }

  // A bar (solid or dashed) covers >35% of a row's width; a digit stroke does not.
  const BAR = 0.35;
  const composites: sharp.OverlayOptions[] = [];

  // BOTTOM band: clear from the first bar row down to the edge.
  const bottomScan = Math.floor(height * 0.55);
  for (let y = bottomScan; y < height; y++) {
    if (rowInk[y]! > BAR) {
      composites.push({
        input: {
          create: { width, height: height - y, channels: 3, background: { r: WHITE, g: WHITE, b: WHITE } },
        },
        top: y,
        left: 0,
      });
      break;
    }
  }

  // TOP band: clear from the top edge down to the LAST bar row in the top 30%.
  const topScan = Math.floor(height * 0.3);
  let barBottom = -1;
  for (let y = 0; y < topScan; y++) {
    if (rowInk[y]! > BAR) barBottom = y;
  }
  if (barBottom >= 0) {
    composites.push({
      input: {
        create: { width, height: barBottom + 1, channels: 3, background: { r: WHITE, g: WHITE, b: WHITE } },
      },
      top: 0,
      left: 0,
    });
  }

  if (composites.length === 0) return binaryPng;
  return sharp(binaryPng).composite(composites).toBuffer();
}

/**
 * Preprocess a single cell crop to give Tesseract its best chance. Designed to
 * be VERSATILE across captcha styles (any digit color, pale/textured
 * backgrounds): inset to skip the tile border, denoise, per-cell Otsu with
 * minority-as-ink, morphological close to repair strokes, speckle removal, then
 * trim + pad + set DPI.
 */
export async function preprocessCell(image: Buffer, box: CellBox): Promise<Buffer> {
  // Crop inward to skip the rounded tile border/edges, which skew the histogram.
  const inset = 0.12;
  const ix = box.x + Math.round(box.width * inset);
  const iy = box.y + Math.round(box.height * inset);
  const iw = Math.max(1, box.width - 2 * Math.round(box.width * inset));
  const ih = Math.max(1, box.height - 2 * Math.round(box.height * inset));

  // Saturation boost makes colored strokes darker than the pale background in
  // grayscale; a strong median + blur erases the dotted texture so the
  // background becomes a uniform light field before we threshold.
  const { data: gray, info } = await sharp(image)
    .extract({ left: ix, top: iy, width: iw, height: ih })
    .resize({ width: iw * UPSCALE, height: ih * UPSCALE, fit: 'fill' })
    .modulate({ saturation: 1.6 })
    .grayscale()
    .median(7) // kill the dotted background texture
    .blur(1.0)
    .normalize()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Per-cell adaptive threshold -> black ink on white (minority class is ink).
  const threshold = otsuThreshold(gray);
  const binData = binarizeMinorityAsInk(gray, threshold);

  const binaryPng = await sharp(binData, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png()
    .toBuffer();

  // Repair broken strokes, then strip leftover speckles.
  const repaired = await closeStrokes(binaryPng);
  const cleaned = await removeHorizontalBars(await sharp(repaired).median(5).toBuffer());

  // Trim to the digit, pad generously, set DPI so Tesseract scales correctly.
  const pad = { top: 40, bottom: 40, left: 40, right: 40, background: { r: WHITE, g: WHITE, b: WHITE } };
  return sharp(cleaned)
    .trim({ threshold: 10 })
    .extend(pad)
    .withMetadata({ density: 150 })
    .png()
    .toBuffer()
    .catch(() =>
      // trim() throws if the image is all one color (blank cell) — fall back.
      sharp(cleaned).extend(pad).withMetadata({ density: 150 }).png().toBuffer(),
    );
}

/** One OCR attempt: the digits read and Tesseract's confidence (0..100). */
export interface OcrRead {
  text: string;
  confidence: number;
}

/**
 * Pick the best digit read from several OCR attempts, weighted by CONFIDENCE.
 *
 * Tesseract often returns the right answer under some page-seg modes and a
 * wrong one under others (e.g. "855" @84 vs "833" @63). A plain frequency vote
 * can tie and pick the wrong one, so we sum each distinct read's confidence and
 * take the highest total. Reads matching the target's digit length are
 * preferred (the background/partial reads are usually shorter).
 */
export function pickBestRead(reads: OcrRead[], targetLen: number): string {
  // Drop empty reads and obvious noise (runs much longer than the target —
  // these come from leftover speckle/underline fragments, never a real cell).
  const maxLen = targetLen + 1;
  const nonEmpty = reads.filter((r) => r.text.length > 0 && r.text.length <= maxLen);
  if (nonEmpty.length === 0) return '';

  const exact = nonEmpty.filter((r) => r.text.length === targetLen);
  const pool = exact.length > 0 ? exact : nonEmpty;

  // Sum confidence per distinct read; tie-break by length.
  const scores = new Map<string, number>();
  for (const r of pool) {
    scores.set(r.text, (scores.get(r.text) ?? 0) + Math.max(1, r.confidence));
  }

  let best = pool[0]!.text;
  let bestScore = -1;
  for (const [value, score] of scores) {
    const tieAdjusted = score + value.length; // small nudge toward longer reads
    if (tieAdjusted > bestScore) {
      bestScore = tieAdjusted;
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

    // Stylized captcha fonts read differently under different page-seg modes
    // AND different OCR engines. We OCR each cell across the cartesian product
    // and VOTE: prefer a read whose length matches the target's, else the most
    // common / longest digit string. More views => more robust across fonts.
    const PSM_MODES = [PSM.SINGLE_BLOCK, PSM.SINGLE_LINE, PSM.SINGLE_WORD, PSM.RAW_LINE];
    const targetLen = digitsOnly(target).length;

    // Two engines: default LSTM and the combined legacy+LSTM, which often reads
    // decorative glyphs the LSTM alone misses.
    const lstm = await createWorker('eng');
    const legacy = await createWorker('eng', OEM.TESSERACT_LSTM_COMBINED);
    try {
      for (const w of [lstm, legacy]) {
        await w.setParameters({ tessedit_char_whitelist: '0123456789' });
      }

      const cells: Cell[] = [];
      for (let index = 0; index < boxes.length; index++) {
        const box = boxes[index]!;
        const cropped = await preprocessCell(input.image, box);

        const reads: OcrRead[] = [];
        for (const w of [lstm, legacy]) {
          for (const psm of PSM_MODES) {
            await w.setParameters({ tessedit_pageseg_mode: psm });
            const { data } = await w.recognize(cropped);
            reads.push({ text: digitsOnly(data.text), confidence: data.confidence });
          }
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
      await Promise.all([lstm.terminate(), legacy.terminate()]);
    }
  }
}
