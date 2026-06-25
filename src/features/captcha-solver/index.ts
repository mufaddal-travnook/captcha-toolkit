/**
 * captcha-solver feature — public surface.
 *
 * `createSolver` is a factory so callers (CLI, future clicker feature,
 * other features) select a method by name without importing concrete
 * classes. Adding a new solver later = one new file + one case here.
 */
import type { Solver, SolverName } from '../../core/types.js';
import { OcrSolver, type OcrSolverOptions } from './OcrSolver.js';
import { OpenAiSolver, type OpenAiSolverOptions } from './OpenAiSolver.js';

export interface CreateSolverOptions {
  ocr?: OcrSolverOptions;
  openai?: OpenAiSolverOptions;
}

export function createSolver(name: SolverName, opts: CreateSolverOptions = {}): Solver {
  switch (name) {
    case 'ocr':
      return new OcrSolver(opts.ocr);
    case 'openai':
      return new OpenAiSolver(opts.openai);
    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown solver: ${String(exhaustive)}`);
    }
  }
}

export { OcrSolver, DEFAULT_GRID_REGION, type OcrSolverOptions } from './OcrSolver.js';
export { OpenAiSolver } from './OpenAiSolver.js';
export {
  readTargetNumber,
  extractTargetNumber,
  DEFAULT_INSTRUCTION_REGION,
  type ReadTargetOptions,
} from './targetReader.js';
