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

/**
 * Among many `.box-label` prompts, find the visible one and extract its target
 * number (e.g. "Please select all boxes with number 797" -> "797").
 */
export async function readVisibleTarget(scope: Page | Frame, promptSelector: string): Promise<string> {
  const labels = scope.locator(promptSelector);
  const count = await labels.count();
  for (let i = 0; i < count; i++) {
    const label = labels.nth(i);
    if (!(await label.isVisible().catch(() => false))) continue;
    const text = (await label.textContent()) ?? '';
    const match = text.match(/\d{3,}/);
    if (match) return match[0];
  }
  throw new Error('Could not read the visible captcha target number.');
}
