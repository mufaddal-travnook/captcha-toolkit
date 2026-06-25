/**
 * Minimal CLI to run a solver against an image file.
 *
 * Usage:
 *   npm run solve -- --target 447 --solver ocr             # reads samples/captcha.png
 *   npm run solve -- --image ./samples/foo.png --solver openai
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSolver } from './features/captcha-solver/index.js';
import type { SolverName } from './core/types.js';

/** Default input image, relative to the project root. */
const DEFAULT_IMAGE = 'samples/newcaptcha.png';

interface Args {
  image: string;
  target?: string;
  solver: SolverName;
  rows: number;
  cols: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const solver = (get('--solver') ?? 'ocr') as SolverName;
  return {
    image: get('--image') ?? DEFAULT_IMAGE,
    target: get('--target'),
    solver,
    rows: Number(get('--rows') ?? 3),
    cols: Number(get('--cols') ?? 3),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const imagePath = resolve(process.cwd(), args.image);
  const image = await readFile(imagePath).catch(() => {
    throw new Error(`Could not read image at "${imagePath}". Put your captcha in samples/ or pass --image <path>.`);
  });
  const solver = createSolver(args.solver);

  const solution = await solver.solve({
    image,
    targetNumber: args.target,
    grid: { rows: args.rows, cols: args.cols },
  });

  console.log(JSON.stringify(solution, null, 2));
  console.log(
    `\nTarget ${solution.targetNumber} found in cells: [${solution.matches.join(', ')}] ` +
      `(via ${solution.solver})`,
  );
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
