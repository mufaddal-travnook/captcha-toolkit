/**
 * Core data contracts shared across all features.
 *
 * The captcha-solver feature produces a `CaptchaSolution`. A future
 * "clicker" feature will consume it. Keeping these types in `core` means
 * features depend on the contract, not on each other.
 */

/** Grid dimensions of a captcha (e.g. 3x3). */
export interface Grid {
  rows: number;
  cols: number;
}

/** Pixel rectangle of a single cell within the source image. */
export interface CellBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pixel point — used by the clicker to know where to tap. */
export interface Point {
  x: number;
  y: number;
}

/**
 * A rectangular region expressed as fractions of the image (0..1).
 * Lets us describe "the top instruction band" or "the grid area" without
 * hardcoding pixels, so it works across image sizes.
 */
export interface FractionalRegion {
  /** Left edge, 0..1. */
  left: number;
  /** Top edge, 0..1. */
  top: number;
  /** Width, 0..1. */
  width: number;
  /** Height, 0..1. */
  height: number;
}

/** Result for one cell of the grid. */
export interface Cell {
  /** Flat index, left-to-right, top-to-bottom (0-based). */
  index: number;
  row: number;
  col: number;
  /** Text the solver read inside this cell (e.g. "447"). Empty if unreadable. */
  value: string;
  /** True if `value` matches the captcha's target number. */
  match: boolean;
  /** Pixel box of this cell within the source image. */
  box: CellBox;
  /** Pixel center of the cell — the clicker clicks here. */
  center: Point;
}

/**
 * The full, solver-agnostic output. Both the OCR and OpenAI solvers
 * return exactly this shape.
 */
export interface CaptchaSolution {
  /** The number the user must find, e.g. "447". */
  targetNumber: string;
  grid: Grid;
  cells: Cell[];
  /** Flat indexes of cells whose value matches the target. */
  matches: number[];
  /** Which solver produced this result. */
  solver: SolverName;
}

export type SolverName = 'ocr' | 'openai';

/** Input every solver accepts. */
export interface SolveInput {
  /** Raw image bytes (PNG/JPEG) of the captcha. */
  image: Buffer;
  /** The number to look for. If omitted, a solver may infer it (OpenAI). */
  targetNumber?: string;
  /** Grid layout. Defaults to 3x3. */
  grid?: Grid;
}

/** Contract every solver implements. */
export interface Solver {
  readonly name: SolverName;
  solve(input: SolveInput): Promise<CaptchaSolution>;
}
