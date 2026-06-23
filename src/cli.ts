/**
 * Minimal CLI to run a solver against an image file.
 *
 * Usage:
 *   npm run solve -- --image ./samples/captcha.png --target 447 --solver ocr
 *   npm run solve -- --image ./samples/captcha.png --target 447 --solver openai
 */
import { readFile } from 'node:fs/promises';
import { createSolver } from './features/captcha-solver/index.js';
import type { SolverName } from './core/types.js';

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

  const image = get('--image');
  if (!image) {
    throw new Error('Missing --image <path>');
  }
  const solver = (get('--solver') ?? 'ocr') as SolverName;
  return {
    image,
    target: get('--target'),
    solver,
    rows: Number(get('--rows') ?? 3),
    cols: Number(get('--cols') ?? 3),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const image = await readFile(args.image);
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
