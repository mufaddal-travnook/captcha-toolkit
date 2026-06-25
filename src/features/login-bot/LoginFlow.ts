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
): Promise<LoginResult> {
  const sel = config.selectors;

  // Navigate. A geo-block / 403 here is fatal (retry won't help).
  const resp = await page.goto(config.url, { waitUntil: 'domcontentloaded' });
  if (resp && (resp.status() === 403 || resp.status() === 203)) {
    throw new FatalError(`Access blocked (HTTP ${resp.status()}). Likely geo/bot block.`);
  }

  // Fill the real (visible) fields among the decoys.
  const emailField = await firstVisible(page, sel.emailCandidates, 'email');
  const passwordField = await firstVisible(page, sel.passwordCandidates, 'password');
  await humanType(emailField, creds.email);
  await humanType(passwordField, creds.password);

  // Trigger the captcha modal.
  await safeClick(page, page.locator(sel.verifyButton));

  // Solve the captcha, retrying transient failures / wrong solves.
  const captcha = await withRetry(
    async () => {
      const result = await solveCaptcha(page, sel, config.solver);
      if (!result.verified) {
        throw new RetryableError(`Captcha not verified (target ${result.target}).`);
      }
      return result;
    },
    {
      retries: config.retries,
      backoffMs: config.backoffMs,
      onRetry: async () => {
        await reloadCaptcha(page, sel).catch(() => {});
      },
    },
  );

  // After verification the Login button is revealed; submit.
  await safeClick(page, page.locator(sel.submitButton));

  // Detect outcome: a URL change away from the login page implies success.
  await page.waitForLoadState('networkidle').catch(() => {});
  const success = !/Account\/LogIn/i.test(page.url());

  return {
    success,
    target: captcha.target,
    matches: captcha.matches,
    message: success
      ? `Logged in (captcha ${captcha.target}, tiles [${captcha.matches.join(', ')}]).`
      : 'Captcha verified but login did not redirect — check credentials or post-login step.',
  };
}
