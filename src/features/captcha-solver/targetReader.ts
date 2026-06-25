/**
 * Stage 1 of the OCR pipeline — read the TARGET NUMBER from the instruction
 * band at the top of a captcha screenshot.
 *
 * The instruction is a sentence like:
 *   "Please select all boxes with number 343"
 * The prompt text is dark/clean (unlike the stylized grid digits), so plain
 * OCR reads it well. We crop just the top band, OCR it, then regex out the
 * first number of the expected length.
 *
 * This is intentionally a SEPARATE module from the grid OCR so each stage is
 * independently testable and swappable. Only used by the OCR solver; the
 * OpenAI solver is untouched.
 */
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';
import { regionToBox } from '../../core/grid.js';
import type { FractionalRegion } from '../../core/types.js';

/** Default instruction band: the top ~22% of the image. */
export const DEFAULT_INSTRUCTION_REGION: FractionalRegion = {
  left: 0,
  top: 0,
  width: 1,
  height: 0.22,
};

export interface ReadTargetOptions {
  /** Which part of the image holds the instruction text. */
  region?: FractionalRegion;
  /** Expected number of digits in the target (e.g. 3 for "343"). */
  digits?: number;
}

/**
 * Pull the first run of `digits` consecutive digits out of OCR text.
 * Returns undefined if none found.
 */
export function extractTargetNumber(text: string, digits = 3): string | undefined {
  const match = text.match(new RegExp(`\\d{${digits}}`));
  return match ? match[0] : undefined;
}

/**
 * Crop the instruction band, OCR it, and extract the target number.
 * Throws if no number of the expected length is found.
 */
export async function readTargetNumber(
  image: Buffer,
  opts: ReadTargetOptions = {},
): Promise<string> {
  const region = opts.region ?? DEFAULT_INSTRUCTION_REGION;
  const digits = opts.digits ?? 3;

  const meta = await sharp(image).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) {
    throw new Error('Could not read image dimensions.');
  }

  const box = regionToBox(region, width, height);
  // Upscale + grayscale + contrast helps OCR on the small prompt line.
  const cropped = await sharp(image)
    .extract({ left: box.x, top: box.y, width: box.width, height: box.height })
    .grayscale()
    .resize({ width: box.width * 2 })
    .normalize()
    .toBuffer();

  const worker = await createWorker('eng');
  try {
    // SINGLE_LINE: the instruction is one line of text.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    const { data } = await worker.recognize(cropped);
    const target = extractTargetNumber(data.text, digits);
    if (!target) {
      throw new Error(
        `Could not read a ${digits}-digit target number from the instruction band. ` +
          `OCR saw: "${data.text.trim()}". Pass --target explicitly or adjust the region.`,
      );
    }
    return target;
  } finally {
    await worker.terminate();
  }
}
