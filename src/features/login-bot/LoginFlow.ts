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
import { createLogger, type Logger } from './logger.js';
import { humanPause } from './human.js';
import type { VisaCombo, ComboResult } from './visaCombos.js';
import { createShooter, type Shooter } from './screenshot.js';

export interface Credentials {
  email: string;
  password: string;
}

export interface LoginResult {
  success: boolean;
  target?: string;
  matches?: number[];
  message: string;
  /** Per-combo outcomes from the visa-form step (for run summaries). */
  comboResults?: ComboResult[];
}

export async function runLoginFlow(
  page: Page,
  config: LoginBotConfig,
  creds: Credentials,
  log: Logger = createLogger(),
  combosOverride?: VisaCombo[],
  shooter: Shooter = createShooter({ enabled: false }),
): Promise<LoginResult> {
  const sel = config.selectors;

  // Navigate. Over a slow proxy the first goto can time out even though the
  // route is fine, so RETRY a few times with a generous timeout before giving
  // up. A real geo-block / 403 is handled separately below (that IS fatal).
  log.step('Logging in…');
  let resp;
  const attempts = Math.max(1, config.navRetries + 1);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      resp = await page.goto(config.url, {
        waitUntil: 'domcontentloaded',
        timeout: config.navTimeoutMs,
      });
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      log.warn(`Navigation attempt ${attempt}/${attempts} failed: ${err instanceof Error ? err.message : err}`);
      if (attempt < attempts) {
        await humanPause(1500, 3000); // brief pause before retrying
      }
    }
  }
  if (lastErr) {
    // Still failing after retries. Screenshot whatever's on screen and fail.
    await shooter.shot(page, 'navigation-failed', 'error');
    throw new FatalError(`Navigation failed after ${attempts} attempts: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
  }
  await shooter.shot(page, 'login-page-loaded');
  if (resp && (resp.status() === 403 || resp.status() === 203)) {
    await shooter.shot(page, `blocked-http-${resp.status()}`, 'error');
    throw new FatalError(`Access blocked (HTTP ${resp.status()}). Likely geo/bot block.`);
  }

  // Fill the real (visible) fields among the decoys.
  const emailField = await firstVisible(page, sel.emailCandidates, 'email');
  const passwordField = await firstVisible(page, sel.passwordCandidates, 'password');
  await humanType(emailField, creds.email);
  await humanPause(500, 1300); // pause between fields, as a person would
  await humanType(passwordField, creds.password);
  await shooter.shot(page, 'login-credentials-filled');

  // Trigger the captcha modal.
  await humanPause(600, 1500); // glance at the form before clicking
  await safeClick(page, page.locator(sel.verifyButton));
  await shooter.shot(page, 'login-captcha-opened');

  // Solve the login captcha, retrying transient failures / wrong solves.
  const captcha = await solveCaptchaWithRetry(
    page,
    sel,
    config.solver,
    {
      retries: config.captcha.retries,
      backoffMs: config.captcha.backoffMs,
      verifyTimeoutMs: config.captcha.verifyTimeoutMs,
      attachTimeoutMs: config.captchaAttachTimeoutMs,
      label: 'login',
    },
    log,
  );

  await shooter.shot(page, 'login-captcha-solved');

  // After verification the Login button is revealed; submit.
  await humanPause(700, 1600); // brief pause after the captcha resolves
  // The submit button is only revealed AFTER the captcha verifies — over a slow
  // proxy this DOM update lags, so wait for it to be visible before clicking.
  await page.locator(sel.submitButton).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  const urlBeforeLogin = page.url();
  await safeClick(page, page.locator(sel.submitButton));

  // Detect outcome: a URL change away from the login page implies success.
  // Over a proxy the redirect is slow, so WAIT for navigation rather than
  // checking the URL immediately. Poll until we leave /Account/LogIn.
  await page
    .waitForURL((url) => !/Account\/LogIn/i.test(url.href), { timeout: 25_000 })
    .catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await shooter.shot(page, 'after-login-submit');
  const success = !/Account\/LogIn/i.test(page.url());

  if (!success) {
    // Capture WHY: log any visible validation/error message on the login form.
    const err = await page
      .locator('.validation-summary, .text-danger, .field-validation-error, .alert')
      .filter({ hasText: /\S/ })
      .first()
      .textContent()
      .catch(() => null);
    const detail = err ? ` Page says: "${err.replace(/\s+/g, ' ').trim().slice(0, 200)}"` : '';
    const message = `Login did not redirect (still at ${page.url()}).${detail}`;
    log.warn(message);
    await shooter.shot(page, 'login-did-not-redirect', 'error');
    void urlBeforeLogin;
    return { success: false, target: captcha.target, matches: captcha.matches, message };
  }

  // Dashboard step: click "Verify Selection", solve the second captcha, then
  // fill + submit the visa form.
  let comboResults: ComboResult[] = [];
  if (config.dashboard.enabled) {
    comboResults = await runDashboardStep(page, config, log, combosOverride, shooter);
  }

  log.step('Automation complete.');
  return {
    success: true,
    target: captcha.target,
    matches: captcha.matches,
    message: `Completed full flow (login captcha ${captcha.target}). Final page: ${page.url()}`,
    comboResults,
  };
}
