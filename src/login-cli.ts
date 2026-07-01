/**
 * CLI for the login bot.
 *
 * Usage (credentials from .env: BLS_EMAIL, BLS_PASSWORD, OPENAI_API_KEY):
 *   npm run login
 *   npm run login -- --solver ocr        # use native OCR instead of OpenAI
 *   npm run login -- --headless          # run without a visible window
 *   npm run login -- --keep-open         # leave the browser open after login
 *   npm run login -- --no-submit         # fill the form but DON'T click submit;
 *                                        # keeps the browser open so YOU submit.
 *   npm run login -- --all               # all 8 combos in ONE session
 *   npm run login -- --batched           # 8 combos in 4 fresh sessions (2 each)
 *   npm run login -- --screenshots all   # off | error | result | all (default: error)
 *   npm run login -- --no-screenshots    # shortcut for --screenshots off
 *   npm run login -- --proxy socks5://localhost:1080   # route via a proxy/tunnel
 */
import { runLogin, runBatched, FatalError } from './features/login-bot/index.js';
import type { SolverName } from './core/types.js';
import type { ScreenshotLevel } from './features/login-bot/screenshot.js';

function get(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const solver = (get(argv, '--solver') ?? 'openai') as SolverName;
  const headed = !argv.includes('--headless');
  const noSubmit = argv.includes('--no-submit');
  const runAll = argv.includes('--all');
  const batched = argv.includes('--batched');
  // Screenshot level: --screenshots <off|error|result|all>. Defaults to config
  // (SCREENSHOT_LEVEL env or 'error'). --no-screenshots is a shortcut for 'off'.
  const screenshotLevel = (
    argv.includes('--no-screenshots') ? 'off' : get(argv, '--screenshots')
  ) as ScreenshotLevel | undefined;
  // Proxy: --proxy <url> overrides PROXY_URL env / config default.
  const proxyServer = get(argv, '--proxy');
  const credentials = {
    email: process.env.BLS_EMAIL ?? '',
    password: process.env.BLS_PASSWORD ?? '',
  };

  // Batched mode: 4 fresh sessions of 2 combos each (own browser/profile/login).
  if (batched) {
    const results = await runBatched({
      config: {
        solver,
        headed,
        ...(screenshotLevel ? { screenshotLevel } : {}),
        ...(proxyServer ? { proxyServer } : {}),
      },
      credentials,
    });
    const okCount = results.filter((r) => r.success).length;
    console.log(`Batched run complete: ${okCount}/${results.length} batches succeeded.`);
    process.exit(okCount > 0 ? 0 : 2);
    return;
  }

  // --no-submit implies keeping the browser open so the user can submit.
  const keepOpen = argv.includes('--keep-open') || noSubmit;

  // A unique profile dir avoids the "profile already in use" collision when a
  // previous persistent-context browser is still open.
  const fresh = argv.includes('--fresh') || noSubmit;
  const userDataDir = fresh
    ? `${process.env.TEMP ?? '/tmp'}/bls-profile-${process.pid}`
    : undefined;

  const result = await runLogin({
    config: {
      solver,
      headed,
      keepOpen,
      ...(screenshotLevel ? { screenshotLevel } : {}),
      ...(proxyServer ? { proxyServer } : {}),
      visaForm: {
        ...(noSubmit ? { submit: false } : {}),
        ...(runAll ? { runAll: true } : {}),
      },
    },
    userDataDir,
    credentials,
  });

  console.log(result.message);
  // With --keep-open, runLogin resolves only after the user closes the window.
  process.exit(result.success ? 0 : 2);
}

main().catch((err) => {
  const fatal = err instanceof FatalError;
  console.error(`${fatal ? 'Fatal' : 'Error'}: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
