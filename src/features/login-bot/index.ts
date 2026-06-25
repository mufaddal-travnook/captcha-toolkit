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
    return await runLoginFlow(page, config, opts.credentials, log);
  } finally {
    log.info('Closing browser and releasing lock.');
    await close();
    await lock.release().catch(() => {});
  }
}

export { DEFAULT_CONFIG } from './config.js';
export type { LoginBotConfig } from './config.js';
export type { LoginResult, Credentials } from './LoginFlow.js';
export { FatalError, RetryableError } from './errors.js';
