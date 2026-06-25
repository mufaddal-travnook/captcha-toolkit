/**
 * CLI: dump the 9 grid cell crops to a folder so you can inspect alignment.
 *
 * Usage:
 *   npm run dump                         # samples/captcha.png -> samples/cells/
 *   npm run dump -- --image samples/x.png --out samples/cells --raw-only
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dumpCells } from './features/captcha-solver/debug.js';

function get(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const imageArg = get(argv, '--image') ?? 'samples/newcaptcha.png';
  const outArg = get(argv, '--out') ?? 'samples/cells';
  const rawOnly = argv.includes('--raw-only');
  const rows = Number(get(argv, '--rows') ?? 3);
  const cols = Number(get(argv, '--cols') ?? 3);

  const imagePath = resolve(process.cwd(), imageArg);
  const outDir = resolve(process.cwd(), outArg);
  const image = await readFile(imagePath).catch(() => {
    throw new Error(`Could not read image at "${imagePath}".`);
  });

  const files = await dumpCells(image, {
    outDir,
    grid: { rows, cols },
    preprocessed: !rawOnly,
  });

  console.log(`Wrote ${files.length} files to ${outDir}:`);
  for (const f of files) console.log('  ' + f);
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
