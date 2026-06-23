/**
 * Debug helper — dump the 9 grid cell crops to disk so you can SEE exactly
 * what the solver feeds to OCR/OpenAI. Useful for checking grid alignment
 * and image quality. Not used by the solvers themselves.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { DEFAULT_GRID, splitIntoCells } from '../../core/grid.js';
import type { Grid } from '../../core/types.js';

export interface DumpCellsOptions {
  /** Output directory for the crops. */
  outDir: string;
  grid?: Grid;
  /**
   * If true, also writes the preprocessed (grayscale/upscaled/binarized)
   * version next to each raw crop — i.e. what OCR actually sees.
   */
  preprocessed?: boolean;
}

/** Same preprocessing the OCR solver applies, mirrored here for inspection. */
async function preprocess(
  image: Buffer,
  box: { x: number; y: number; width: number; height: number },
): Promise<Buffer> {
  return sharp(image)
    .extract({ left: box.x, top: box.y, width: box.width, height: box.height })
    .grayscale()
    .resize({ width: box.width * 3, height: box.height * 3, fit: 'fill' })
    .normalize()
    .threshold(140)
    .toBuffer();
}

/**
 * Write each grid cell as `cell-<index>.png` (and `cell-<index>.ocr.png` if
 * `preprocessed`). Returns the list of files written.
 */
export async function dumpCells(image: Buffer, opts: DumpCellsOptions): Promise<string[]> {
  const grid = opts.grid ?? DEFAULT_GRID;
  const meta = await sharp(image).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) {
    throw new Error('Could not read image dimensions.');
  }

  await mkdir(opts.outDir, { recursive: true });
  const boxes = splitIntoCells(width, height, grid);
  const written: string[] = [];

  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index]!;
    const rawPath = join(opts.outDir, `cell-${index}.png`);
    const raw = await sharp(image)
      .extract({ left: box.x, top: box.y, width: box.width, height: box.height })
      .png()
      .toBuffer();
    await writeFile(rawPath, raw);
    written.push(rawPath);

    if (opts.preprocessed) {
      const ocrPath = join(opts.outDir, `cell-${index}.ocr.png`);
      await writeFile(ocrPath, await preprocess(image, box));
      written.push(ocrPath);
    }
  }

  return written;
}
