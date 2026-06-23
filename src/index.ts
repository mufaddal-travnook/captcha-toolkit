/**
 * Public package entrypoint. Re-exports the stable surface so consumers
 * import from one place: core contracts + features.
 */
export * from './core/types.js';
export * from './core/grid.js';
export * from './core/text.js';
export { createSolver, OcrSolver, OpenAiSolver } from './features/captcha-solver/index.js';
export type { CreateSolverOptions } from './features/captcha-solver/index.js';
