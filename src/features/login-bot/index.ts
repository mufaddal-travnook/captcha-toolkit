/**
 * login-bot feature — public entry. Composes lock -> stealth browser -> login
 * flow -> guaranteed teardown.
 */
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchBrowser } from './Browser.js';
import { runLoginFlow, type Credentials, type LoginResult } from './LoginFlow.js';
import { acquireLock } from './lock.js';
import { FatalError } from './errors.js';
import { createLogger } from './logger.js';
import { DEFAULT_CONFIG, type LoginBotConfig } from './config.js';

export interface RunLoginOptions {
  config?: Partial<LoginBotConfig>;
  credentials: Credentials;
  /** Lockfile path; defaults to the OS temp dir. */
  lockPath?: string;
}

export async function runLogin(opts: RunLoginOptions): Promise<LoginResult> {
  const config: LoginBotConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const log = createLogger();

  if (config.solver === 'openai' && !process.env.OPENAI_API_KEY) {
    throw new FatalError('OPENAI_API_KEY is required for the openai solver. Set it in .env.');
  }
  if (!opts.credentials.email || !opts.credentials.password) {
    throw new FatalError('Missing credentials. Set BLS_EMAIL and BLS_PASSWORD in .env.');
  }

  const lockPath = opts.lockPath ?? join(tmpdir(), 'bls-login-bot.lock');
  log.step(`Acquiring single-instance lock: ${lockPath}`);
  const lock = await acquireLock(lockPath);

  log.step(`Launching ${config.headed ? 'headed' : 'headless'} stealth Chrome…`);
  const { page, close } = await launchBrowser({
    headed: config.headed,
    timeoutMs: config.timeoutMs,
  });

  try {
    const result = await runLoginFlow(page, config, opts.credentials, log);
    if (config.keepOpen) {
      // Surface the result now, then leave the browser open. Release the lock
      // (the run is done) but keep the process alive so the window persists.
      log.info(result.message);
      await lock.release().catch(() => {});
      log.info('Leaving browser open (keepOpen). Close the window or press Ctrl+C to exit.');
      await waitForBrowserClose(page);
    }
    return result;
  } finally {
    if (!config.keepOpen) {
      log.info('Closing browser and releasing lock.');
      await close();
      await lock.release().catch(() => {});
    }
  }
}

/** Resolve only when the browser/page is closed (by the user). */
function waitForBrowserClose(page: import('playwright').Page): Promise<void> {
  return new Promise<void>((resolve) => {
    page.on('close', () => resolve());
    page.context().on('close', () => resolve());
    page.context().browser()?.on('disconnected', () => resolve());
  });
}

export { DEFAULT_CONFIG } from './config.js';
export type { LoginBotConfig } from './config.js';
export type { LoginResult, Credentials } from './LoginFlow.js';
export { FatalError, RetryableError } from './errors.js';
