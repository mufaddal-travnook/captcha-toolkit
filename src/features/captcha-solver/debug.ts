/**
 * Debug helper — dump the 9 grid cell crops to disk so you can SEE exactly
 * what the solver feeds to OCR/OpenAI. Useful for checking grid alignment
 * and image quality. Not used by the solvers themselves.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { DEFAULT_GRID, regionToBox, splitRegionIntoCells } from '../../core/grid.js';
import type { FractionalRegion, Grid } from '../../core/types.js';
import { DEFAULT_GRID_REGION, preprocessCell } from './OcrSolver.js';

export interface DumpCellsOptions {
  /** Output directory for the crops. */
  outDir: string;
  grid?: Grid;
  /** Grid region within the image (fractions). Defaults to the OCR solver's region. */
  gridRegion?: FractionalRegion;
  /**
   * If true, also writes the preprocessed (grayscale/upscaled/binarized)
   * version next to each raw crop — i.e. what OCR actually sees.
   */
  preprocessed?: boolean;
}

/** Reuse the OCR solver's exact preprocessing so dumps match what OCR sees. */
async function preprocess(
  image: Buffer,
  box: { x: number; y: number; width: number; height: number },
): Promise<Buffer> {
  return preprocessCell(image, box);
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
  const regionBox = regionToBox(opts.gridRegion ?? DEFAULT_GRID_REGION, width, height);
  const boxes = splitRegionIntoCells(regionBox, grid);
  const written: string[] = [];

  // Also dump the whole grid region so you can verify the crop alignment.
  const regionPath = join(opts.outDir, 'region.png');
  await writeFile(
    regionPath,
    await sharp(image)
      .extract({ left: regionBox.x, top: regionBox.y, width: regionBox.width, height: regionBox.height })
      .png()
      .toBuffer(),
  );
  written.push(regionPath);

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
