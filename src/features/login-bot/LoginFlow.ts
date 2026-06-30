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
import type { VisaCombo } from './visaCombos.js';
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

  // Navigate. A geo-block / 403 here is fatal (retry won't help).
  log.step('Logging in…');
  const resp = await page.goto(config.url, { waitUntil: 'domcontentloaded' });
  await shooter.shot(page, 'login-page-loaded');
  if (resp && (resp.status() === 403 || resp.status() === 203)) {
    await shooter.shot(page, `blocked-http-${resp.status()}`);
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
      label: 'login',
    },
    log,
  );

  await shooter.shot(page, 'login-captcha-solved');

  // After verification the Login button is revealed; submit.
  await humanPause(700, 1600); // brief pause after the captcha resolves
  await safeClick(page, page.locator(sel.submitButton));

  // Detect outcome: a URL change away from the login page implies success.
  await page.waitForLoadState('networkidle').catch(() => {});
  await shooter.shot(page, 'after-login-submit');
  const success = !/Account\/LogIn/i.test(page.url());

  if (!success) {
    const message =
      'Captcha verified but login did not redirect — check credentials or post-login step.';
    log.warn(message);
    return { success: false, target: captcha.target, matches: captcha.matches, message };
  }

  // Dashboard step: click "Verify Selection", solve the second captcha, then
  // fill + submit the visa form.
  if (config.dashboard.enabled) {
    await runDashboardStep(page, config, log, combosOverride, shooter);
  }

  log.step('Automation complete.');
  return {
    success: true,
    target: captcha.target,
    matches: captcha.matches,
    message: `Completed full flow (login captcha ${captcha.target}). Final page: ${page.url()}`,
  };
}
