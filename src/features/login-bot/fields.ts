/**
 * Honeypot-aware field resolution.
 *
 * The login form has 10 decoy email + 10 decoy password inputs, and the captcha
 * prompt has ~26 decoy labels. Only ONE of each is actually visible. We pick the
 * visible one at runtime rather than trusting a fixed id (which can rotate).
 */
import type { Frame, Locator, Page } from 'playwright';

/**
 * Return the first VISIBLE locator among candidate selectors. Throws if none is
 * visible (so the caller can treat it as a fatal "form changed" condition).
 */
export async function firstVisible(
  scope: Page | Frame,
  selectors: string[],
  label: string,
): Promise<Locator> {
  for (const sel of selectors) {
    const loc = scope.locator(sel);
    if ((await loc.count()) > 0 && (await loc.first().isVisible().catch(() => false))) {
      return loc.first();
    }
  }
  throw new Error(`No visible ${label} field found among: ${selectors.join(', ')}`);
}
