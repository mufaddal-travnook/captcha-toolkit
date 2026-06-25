/**
 * CLI for the login bot.
 *
 * Usage (credentials from .env: BLS_EMAIL, BLS_PASSWORD, OPENAI_API_KEY):
 *   npm run login
 *   npm run login -- --solver ocr        # use native OCR instead of OpenAI
 *   npm run login -- --headless          # run without a visible window
 */
import { runLogin, FatalError } from './features/login-bot/index.js';
import type { SolverName } from './core/types.js';

function get(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const solver = (get(argv, '--solver') ?? 'openai') as SolverName;
  const headed = !argv.includes('--headless');

  const result = await runLogin({
    config: { solver, headed },
    credentials: {
      email: process.env.BLS_EMAIL ?? '',
      password: process.env.BLS_PASSWORD ?? '',
    },
  });

  console.log(result.message);
  process.exit(result.success ? 0 : 2);
}

main().catch((err) => {
  const fatal = err instanceof FatalError;
  console.error(`${fatal ? 'Fatal' : 'Error'}: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
