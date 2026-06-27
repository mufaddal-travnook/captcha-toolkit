/**
 * DashboardFlow — runs AFTER login. The dashboard reuses the same control ids
 * as the login page (#btnVerify "Verify Selection", #btnSubmit "Submit"):
 *   1. click #btnVerify → opens the (same) captcha
 *   2. solve it (reusing the shared captcha bridge)
 *   3. click #btnSubmit → a new page with a form loads
 */
import type { Page } from 'playwright';
import type { LoginBotConfig } from './config.js';
import { solveCaptchaWithRetry } from './CaptchaBridge.js';
import { runVisaFormFlow } from './VisaFormFlow.js';
import { safeClick } from './safeClick.js';
import { createLogger, type Logger } from './logger.js';
import { humanPause } from './human.js';

/**
 * The captcha part of the dashboard: click "Verify Selection", solve the
 * captcha, click "Submit", and wait for the next page (the visa form) to load.
 * Reused by the initial flow AND by the bot-page recovery (going back from
 * /account/bot lands here, on the Verify Selection page, again).
 */
export async function runDashboardCaptcha(
  page: Page,
  config: LoginBotConfig,
  log: Logger = createLogger(),
): Promise<void> {
  const dash = config.dashboard;
  const sel = config.selectors;

  await page.waitForLoadState('networkidle').catch(() => {});
  await humanPause(800, 1800);

  const urlBefore = page.url();

  // 1. Click "Verify Selection" (#btnVerify) to open the dashboard captcha.
  log.step('Dashboard: clicking Verify Selection…');
  await safeClick(page, page.locator(dash.verifyButton).first());

  // 2. Solve the dashboard captcha (identical DOM → reuse the shared solver).
  const captcha = await solveCaptchaWithRetry(
    page,
    sel,
    config.solver,
    { retries: config.retries, backoffMs: config.backoffMs, label: 'dashboard' },
    log,
  );

  // 3. Click "Submit" (#btnSubmit), revealed after the captcha verifies, then
  //    wait for the next page (the form) to load.
  await humanPause(700, 1500);
  log.step('Dashboard: clicking Submit…');
  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => {}),
    safeClick(page, page.locator(dash.submitButton).first()),
  ]);

  // Confirm we navigated to a new page (runs in the browser; `location` exists
  // there — typed loosely since the project targets Node, no DOM lib).
  const navAway = (prev: string): boolean =>
    // @ts-expect-error browser global available at runtime inside waitForFunction
    location.href !== prev;
  await page.waitForFunction(navAway, urlBefore, { timeout: 15_000 }).catch(() => {});
  log.info(`Dashboard captcha complete (target ${captcha.target}). New page: ${page.url()}`);
}

export async function runDashboardStep(
  page: Page,
  config: LoginBotConfig,
  log: Logger = createLogger(),
): Promise<void> {
  // Verify Selection → captcha → Submit → visa form opens.
  await runDashboardCaptcha(page, config, log);
  // The new page is the visa-type form — fill it.
  await runVisaFormFlow(page, config, log);
}
