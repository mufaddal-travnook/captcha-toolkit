/**
 * LoginFlow — orchestrates the full login: navigate, fill the visible (real)
 * fields, verify, solve the captcha (with retries), and submit.
 */
import type { Page } from 'playwright';
import type { LoginBotConfig } from './config.js';
import { firstVisible } from './fields.js';
import { humanType, safeClick } from './safeClick.js';
import { solveCaptcha, reloadCaptcha } from './CaptchaBridge.js';
import { FatalError, RetryableError, withRetry } from './errors.js';
import { createLogger, maskEmail, maskSecret, type Logger } from './logger.js';
import { humanPause } from './human.js';

export interface Credentials {
  email: string;
  password: string;
}

export interface LoginResult {
  success: boolean;
  target?: string;
  matches?: number[];
  message: string;
}

export async function runLoginFlow(
  page: Page,
  config: LoginBotConfig,
  creds: Credentials,
  log: Logger = createLogger(),
): Promise<LoginResult> {
  const sel = config.selectors;

  // Navigate. A geo-block / 403 here is fatal (retry won't help).
  log.step(`Navigating to login page: ${config.url}`);
  const resp = await page.goto(config.url, { waitUntil: 'domcontentloaded' });
  log.info(`Page loaded (HTTP ${resp?.status() ?? 'n/a'}).`);
  if (resp && (resp.status() === 403 || resp.status() === 203)) {
    throw new FatalError(`Access blocked (HTTP ${resp.status()}). Likely geo/bot block.`);
  }

  // Fill the real (visible) fields among the decoys.
  log.step('Locating the visible email/password fields among decoys…');
  const emailField = await firstVisible(page, sel.emailCandidates, 'email');
  const passwordField = await firstVisible(page, sel.passwordCandidates, 'password');
  await humanType(emailField, creds.email);
  log.info(`Email entered: ${maskEmail(creds.email)}`);
  await humanPause(500, 1300); // pause between fields, as a person would
  await humanType(passwordField, creds.password);
  log.info(`Password entered: ${maskSecret(creds.password)}`);

  // Trigger the captcha modal.
  await humanPause(600, 1500); // glance at the form before clicking
  log.step('Clicking Verify to open the captcha…');
  await safeClick(page, page.locator(sel.verifyButton));

  // Solve the captcha, retrying transient failures / wrong solves.
  let attempt = 0;
  const captcha = await withRetry(
    async () => {
      attempt++;
      log.step(`Solving captcha (attempt ${attempt}) via '${config.solver}' solver…`);
      const result = await solveCaptcha(page, sel, config.solver, log);
      if (!result.verified) {
        throw new RetryableError(`Captcha not verified (target ${result.target}).`);
      }
      log.info(`Captcha verified ✓ (target ${result.target}).`);
      return result;
    },
    {
      retries: config.retries,
      backoffMs: config.backoffMs,
      onRetry: async (n, err) => {
        log.warn(`Captcha attempt failed: ${err instanceof Error ? err.message : err}`);
        log.step(`Reloading images before retry ${n}…`);
        await reloadCaptcha(page, sel).catch(() => {});
      },
    },
  );

  // After verification the Login button is revealed; submit.
  await humanPause(700, 1600); // brief pause after the captcha resolves
  log.step('Submitting login…');
  await safeClick(page, page.locator(sel.submitButton));

  // Detect outcome: a URL change away from the login page implies success.
  await page.waitForLoadState('networkidle').catch(() => {});
  const success = !/Account\/LogIn/i.test(page.url());
  log.info(`Post-login URL: ${page.url()}`);

  const message = success
    ? `Logged in (captcha ${captcha.target}, tiles [${captcha.matches.join(', ')}]).`
    : 'Captcha verified but login did not redirect — check credentials or post-login step.';
  if (success) log.step(message);
  else log.warn(message);

  return { success, target: captcha.target, matches: captcha.matches, message };
}
