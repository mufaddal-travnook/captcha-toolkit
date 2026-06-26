/**
 * LoginFlow — orchestrates the full login: navigate, fill the visible (real)
 * fields, verify, solve the captcha (with retries), and submit.
 */
import type { Page } from 'playwright';
import type { LoginBotConfig } from './config.js';
import { firstVisible } from './fields.js';
import { humanType, safeClick } from './safeClick.js';
import { solveCaptchaWithRetry } from './CaptchaBridge.js';
import { runDashboardStep } from './DashboardFlow.js';
import { FatalError } from './errors.js';
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

  // Solve the login captcha, retrying transient failures / wrong solves.
  const captcha = await solveCaptchaWithRetry(
    page,
    sel,
    config.solver,
    { retries: config.retries, backoffMs: config.backoffMs, label: 'login' },
    log,
  );

  // After verification the Login button is revealed; submit.
  await humanPause(700, 1600); // brief pause after the captcha resolves
  log.step('Submitting login…');
  await safeClick(page, page.locator(sel.submitButton));

  // Detect outcome: a URL change away from the login page implies success.
  await page.waitForLoadState('networkidle').catch(() => {});
  const success = !/Account\/LogIn/i.test(page.url());
  log.info(`Post-login URL: ${page.url()}`);

  if (!success) {
    const message =
      'Captcha verified but login did not redirect — check credentials or post-login step.';
    log.warn(message);
    return { success: false, target: captcha.target, matches: captcha.matches, message };
  }

  log.step(`Logged in (login captcha ${captcha.target}, tiles [${captcha.matches.join(', ')}]).`);

  // Dashboard step: click "Verify Selection", solve the second captcha, then
  // fill + submit the visa form.
  if (config.dashboard.enabled) {
    await runDashboardStep(page, config, log);
  }

  log.step(`Automation complete. Final page: ${page.url()}`);
  return {
    success: true,
    target: captcha.target,
    matches: captcha.matches,
    message: `Completed full flow (login captcha ${captcha.target}). Final page: ${page.url()}`,
  };
}
