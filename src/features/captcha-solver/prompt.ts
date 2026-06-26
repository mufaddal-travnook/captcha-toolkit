/**
 * Dedicated prompt for the OpenAI Vision solver.
 *
 * Kept separate so the prompt can be iterated/tuned without touching solver
 * logic, and so it's testable in isolation. The model is asked to ONLY read
 * numbers and return strict JSON — pixel geometry is computed locally.
 */
import type { Grid } from '../../core/types.js';

export interface BuildPromptArgs {
  grid: Grid;
  /** Known target number, or undefined to let the model read it from the image. */
  targetNumber?: string;
}

/**
 * Build the user-facing instruction text sent alongside the captcha image.
 */
export function buildSolvePrompt({ grid, targetNumber }: BuildPromptArgs): string {
  const total = grid.rows * grid.cols;
  const targetHint = targetNumber
    ? `The target number is "${targetNumber}".`
    : 'Read the target number from the prompt text shown in the image (e.g. "select all boxes with number NNN").';

  return [
    `You are reading a ${grid.rows}x${grid.cols} grid captcha image.`,
    targetHint,
    `The grid has ${total} cells. Index them 0-based in READING ORDER:`,
    `left-to-right within each row, then top-to-bottom (cell 0 = top-left,`,
    `cell ${grid.cols - 1} = top-right, cell ${total - 1} = bottom-right).`,
    'Read the number printed in each cell. Ignore styling, color, rotation, and',
    'background noise — only the digits matter.',
    'Return ONLY a JSON object of this exact shape (no markdown, no commentary):',
    `{"targetNumber":"<digits>","values":["<cell0>","<cell1>", ...exactly ${total} entries]}`,
    'Each value must contain digits only. If a cell is unreadable, use an empty string "".',
  ].join(' ');
}

/** Optional system message to steer the model toward strict, terse JSON. */
export const SOLVE_SYSTEM_PROMPT =
  'You are a precise OCR engine for grid captchas. You only output valid JSON matching the requested schema.';
