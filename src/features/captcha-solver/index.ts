/**
 * captcha-solver feature — public surface.
 *
 * `createSolver` is a factory so callers (CLI, future clicker feature,
 * other features) select a method by name without importing concrete
 * classes. Adding a new solver later = one new file + one case here.
 */
import type { Solver, SolverName } from '../../core/types.js';
import { OcrSolver } from './OcrSolver.js';
import { OpenAiSolver, type OpenAiSolverOptions } from './OpenAiSolver.js';

export interface CreateSolverOptions {
  openai?: OpenAiSolverOptions;
}

export function createSolver(name: SolverName, opts: CreateSolverOptions = {}): Solver {
  switch (name) {
    case 'ocr':
      return new OcrSolver();
    case 'openai':
      return new OpenAiSolver(opts.openai);
    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown solver: ${String(exhaustive)}`);
    }
  }
}

export { OcrSolver } from './OcrSolver.js';
export { OpenAiSolver } from './OpenAiSolver.js';
