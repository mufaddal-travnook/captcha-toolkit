/**
 * Method B — OpenAI Vision solver.
 *
 * Sends the whole captcha image to a vision model and asks it to read the
 * grid values (and, optionally, the target number from the prompt text).
 * The model only READS numbers — pixel geometry / "where to click" is still
 * computed locally via core/grid, so the output matches the OCR solver.
 */
import OpenAI from 'openai';
import { DEFAULT_GRID, cellCount, centerOf, splitIntoCells } from '../../core/grid.js';
import { digitsOnly, isMatch } from '../../core/text.js';
import type { Cell, CaptchaSolution, Solver, SolveInput } from '../../core/types.js';
import { buildSolvePrompt, SOLVE_SYSTEM_PROMPT } from './prompt.js';

export interface OpenAiSolverOptions {
  apiKey?: string;
  model?: string;
  client?: OpenAI;
  /** Called with the model's raw response text (before parsing) — for logging. */
  onRawResponse?: (raw: string) => void;
}

/** Shape we ask the model to return. */
interface VisionResult {
  targetNumber: string;
  /** Read values in flat order, length = rows*cols. */
  values: string[];
}

export class OpenAiSolver implements Solver {
  readonly name = 'openai' as const;
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly onRawResponse?: (raw: string) => void;

  constructor(opts: OpenAiSolverOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    this.client = opts.client ?? new OpenAI({ apiKey });
    this.model = opts.model ?? 'gpt-4o';
    this.onRawResponse = opts.onRawResponse;
  }

  async solve(input: SolveInput): Promise<CaptchaSolution> {
    const grid = input.grid ?? DEFAULT_GRID;
    const total = cellCount(grid);

    const vision = await this.readGrid(input, grid);
    const target = input.targetNumber ?? vision.targetNumber;
    if (!target) {
      throw new Error('No target number supplied and the model could not infer one.');
    }

    // Geometry is computed locally — independent of the model.
    const meta = await this.imageSize(input.image);
    const boxes = splitIntoCells(meta.width, meta.height, grid);

    const cells: Cell[] = boxes.map((box, index) => {
      const value = digitsOnly(vision.values[index] ?? '');
      return {
        index,
        row: Math.floor(index / grid.cols),
        col: index % grid.cols,
        value,
        match: isMatch(value, target),
        box,
        center: centerOf(box),
      };
    });

    if (vision.values.length !== total) {
      // Don't crash — surface a readable error for callers/tests.
      throw new Error(
        `Model returned ${vision.values.length} values, expected ${total} for a ${grid.rows}x${grid.cols} grid.`,
      );
    }

    return {
      targetNumber: target,
      grid,
      cells,
      matches: cells.filter((c) => c.match).map((c) => c.index),
      solver: this.name,
    };
  }

  private async readGrid(input: SolveInput, grid: typeof DEFAULT_GRID): Promise<VisionResult> {
    const dataUrl = `data:image/png;base64,${input.image.toString('base64')}`;
    const prompt = buildSolvePrompt({ grid, targetNumber: input.targetNumber });

    const completion = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SOLVE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    this.onRawResponse?.(raw);
    const parsed = JSON.parse(raw) as Partial<VisionResult>;
    return {
      targetNumber: digitsOnly(parsed.targetNumber ?? ''),
      values: Array.isArray(parsed.values) ? parsed.values.map(String) : [],
    };
  }

  private async imageSize(image: Buffer): Promise<{ width: number; height: number }> {
    // Lazy import keeps sharp out of the hot path when only mocking.
    const sharp = (await import('sharp')).default;
    const meta = await sharp(image).metadata();
    if (!meta.width || !meta.height) {
      throw new Error('Could not read image dimensions.');
    }
    return { width: meta.width, height: meta.height };
  }
}
