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
import { ALL_COMBOS, comboLabel, type VisaCombo } from './visaCombos.js';
import { createShooter } from './screenshot.js';
import { createSummaryNotifier } from '../notifier/index.js';
import { checkProxy } from './proxyCheck.js';

/** Recursively-optional config, so callers can override just nested fields.
 *  Arrays and primitives are kept whole (not recursed into). */
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface RunLoginOptions {
  config?: DeepPartial<LoginBotConfig>;
  credentials: Credentials;
  /** Lockfile path; defaults to the OS temp dir. */
  lockPath?: string;
  /** Persistent-profile dir. Defaults to a shared temp profile. */
  userDataDir?: string;
  /** Restrict the visa form to these combos (e.g. one batch). Overrides runAll. */
  combos?: VisaCombo[];
}

export async function runLogin(opts: RunLoginOptions): Promise<LoginResult> {
  // Shallow-merge top level, but DEEP-merge the nested config objects so a
  // partial override (e.g. { visaForm: { submit: false } }) keeps the rest.
  const o = opts.config ?? {};
  const config: LoginBotConfig = {
    ...DEFAULT_CONFIG,
    ...o,
    selectors: { ...DEFAULT_CONFIG.selectors, ...(o.selectors ?? {}) },
    captcha: { ...DEFAULT_CONFIG.captcha, ...(o.captcha ?? {}) },
    dashboard: { ...DEFAULT_CONFIG.dashboard, ...(o.dashboard ?? {}) },
    visaForm: { ...DEFAULT_CONFIG.visaForm, ...(o.visaForm ?? {}) },
  };
  const log = createLogger();

  if (config.solver === 'openai' && !process.env.OPENAI_API_KEY) {
    throw new FatalError('OPENAI_API_KEY is required for the openai solver. Set it in .env.');
  }
  if (!opts.credentials.email || !opts.credentials.password) {
    throw new FatalError('Missing credentials. Set BLS_EMAIL and BLS_PASSWORD in .env.');
  }

  // Pre-flight: if a proxy is configured, verify the tunnel is actually up
  // BEFORE doing anything. A dead tunnel otherwise fails later as a confusing
  // 403 / "no redirect". On failure, alert and stop (a retry won't help here).
  if (config.proxyServer) {
    log.step(`Checking proxy ${config.proxyServer}…`);
    const check = await checkProxy(config.proxyServer);
    if (!check.ok) {
      const msg = `Proxy/tunnel unreachable (${config.proxyServer}): ${check.error}. Is the SSH tunnel up?`;
      log.error(msg);
      await createSummaryNotifier({ log: () => {} })
        .notify('error', { message: msg, combo: 'proxy pre-flight' })
        .catch(() => {});
      throw new FatalError(msg);
    }
    log.info(`Proxy OK — exit IP: ${check.ip}`);
  }

  const lockPath = opts.lockPath ?? join(tmpdir(), 'bls-login-bot.lock');
  const lock = await acquireLock(lockPath);

  const { page, close } = await launchBrowser({
    headed: config.headed,
    timeoutMs: config.timeoutMs,
    userDataDir: opts.userDataDir,
    proxyServer: config.proxyServer || undefined,
  });
  if (config.proxyServer) log.info(`Using proxy: ${config.proxyServer}`);

  const shooter = createShooter({
    level: config.screenshotLevel,
    fullPage: config.screenshotsFullPage,
    log: (m) => log.warn(m), // only failures are logged
  });

  try {
    const result = await runLoginFlow(page, config, opts.credentials, log, opts.combos, shooter);
    if (config.keepOpen) {
      // Surface the result now, then leave the browser open. Release the lock
      // (the run is done) but keep the process alive so the window persists.
      log.info(result.message);
      await lock.release().catch(() => {});
      log.info('Browser left open. Close the window or press Ctrl+C to exit.');
      await waitForBrowserClose(page);
    }
    return result;
  } finally {
    if (!config.keepOpen) {
      await close();
      await lock.release().catch(() => {});
    }
  }
}

export interface RunBatchedOptions {
  config?: DeepPartial<LoginBotConfig>;
  credentials: Credentials;
  /** Combos to process (defaults to all 8). */
  combos?: VisaCombo[];
  /** Combos per batch / fresh session (default from config.visaForm.batchSize). */
  batchSize?: number;
  /** Min/max gap between batches (ms). Defaults to config.visaForm.betweenRunsMs ±jitter. */
  betweenRunsMs?: number;
}

/**
 * Run the combos in BATCHES, each in a FRESH browser session (own login,
 * dashboard captcha, profile). Looks like several short visits rather than one
 * long 8-combo marathon. Each batch notifies independently (slot/bot-block).
 */
export async function runBatched(opts: RunBatchedOptions): Promise<LoginResult[]> {
  const log = createLogger();
  const vf = { ...DEFAULT_CONFIG.visaForm, ...(opts.config?.visaForm ?? {}) };
  const combos = opts.combos ?? ALL_COMBOS;
  const batchSize = Math.max(1, opts.batchSize ?? vf.batchSize);
  const gap = opts.betweenRunsMs ?? vf.betweenRunsMs;

  const batches: VisaCombo[][] = [];
  for (let i = 0; i < combos.length; i += batchSize) {
    batches.push(combos.slice(i, i + batchSize));
  }

  log.step(`Batched run: ${combos.length} combos in ${batches.length} batches of ${batchSize}.`);
  const results: LoginResult[] = [];

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]!;
    log.step(`════ BATCH ${b + 1}/${batches.length}: ${batch.map(comboLabel).join('  |  ')} ════`);

    try {
      const result = await runLogin({
        // Each batch keeps the browser closing (don't keepOpen between batches),
        // and uses a UNIQUE profile + lock so sessions are independent.
        config: { ...opts.config, keepOpen: false },
        credentials: opts.credentials,
        combos: batch,
        userDataDir: `${process.env.TEMP ?? '/tmp'}/bls-profile-batch-${b + 1}-${process.pid}`,
        lockPath: `${process.env.TEMP ?? '/tmp'}/bls-login-bot-batch-${b + 1}.lock`,
      });
      results.push(result);
      log.info(`Batch ${b + 1}/${batches.length} done: ${result.message}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Batch ${b + 1}/${batches.length} failed: ${msg}. Continuing.`);
      results.push({ success: false, message: msg });
    }

    // Short jittered gap before the next batch (not after the last).
    if (b < batches.length - 1) {
      const wait = Math.round(gap * (0.75 + Math.random() * 0.5));
      log.info(`Waiting ${(wait / 1000).toFixed(0)}s before the next batch…`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  log.step('════ BATCHED RUN COMPLETE ════');

  // Final run summary → the SECOND (summary) Telegram bot. Disabled/no-op if its
  // creds aren't set. Lists every batch + every combo outcome.
  await sendRunSummary(results, batches, log);

  return results;
}

/** Send one consolidated run summary to the summary bot at the very end. */
async function sendRunSummary(
  results: LoginResult[],
  batches: VisaCombo[][],
  log: { info: (m: string) => void },
): Promise<void> {
  const summary = createSummaryNotifier({ log: (m) => log.info(m) });
  if (!summary.enabled) return;

  const lines: string[] = [];
  let okCombos = 0;
  let totalCombos = 0;
  let slots = 0;

  results.forEach((res, i) => {
    const label = (batches[i] ?? []).map(comboLabel).join(' | ') || `batch ${i + 1}`;
    if (!res.success && (!res.comboResults || res.comboResults.length === 0)) {
      // Batch failed before producing combo results (e.g. 403 at login).
      lines.push(`✗ Batch ${i + 1}: ${res.message}`);
      return;
    }
    for (const c of res.comboResults ?? []) {
      totalCombos++;
      if (c.ok) okCombos++;
      if (c.slot) slots++;
      const icon = c.slot ? '🟢' : c.ok ? '✓' : '✗';
      lines.push(`${icon} ${c.combo} — ${c.note}`);
    }
    void label;
  });

  const overall =
    slots > 0
      ? `🟢 ${slots} possible SLOT(S) found!`
      : totalCombos > 0
        ? `${okCombos}/${totalCombos} combos submitted OK across ${results.length} batches.`
        : `Run finished — no combos completed (${results.length} batches).`;

  await summary.notify('batch-summary', {
    summaryLine: overall,
    comboLines: lines.join('\n'),
  });
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
export { ALL_COMBOS } from './visaCombos.js';
export type { VisaCombo } from './visaCombos.js';
