/**
 * Click helpers that wait for stability and dismiss loaders before acting, to
 * avoid race-condition timeouts (spinner/overlay intercepting the click).
 */
import type { Frame, Locator, Page } from 'playwright';
import { humanPause, keyDelay, preActionJitter, sleep } from './human.js';

/** Wait for any visible loading spinner/overlay to disappear. Best-effort. */
async function waitForLoadersGone(scope: Page | Frame): Promise<void> {
  const loaderSelectors = ['.k-loading-mask', '.loading', '.spinner', '.overlay'];
  for (const sel of loaderSelectors) {
    await scope
      .locator(sel)
      .first()
      .waitFor({ state: 'hidden', timeout: 3000 })
      .catch(() => {});
  }
}

/**
 * Click a locator after waiting for it to be visible, stable, and unobstructed.
 * Adds a small randomized pre-action pause to mimic human reaction time.
 */
export async function safeClick(scope: Page | Frame, locator: Locator): Promise<void> {
  await waitForLoadersGone(scope);
  await locator.waitFor({ state: 'visible' });
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await preActionJitter();
  // Hover first (humans move to a target before clicking), then click.
  await locator.hover().catch(() => {});
  await sleep(80);
  await locator.click();
}

/**
 * Type into a field like a human: focus, a brief pause, then per-character with
 * variable cadence (occasional hesitations), after clearing it.
 */
export async function humanType(locator: Locator, text: string): Promise<void> {
  await locator.waitFor({ state: 'visible' });
  await preActionJitter();
  await locator.click();
  await locator.fill('');
  await humanPause(200, 500);
  for (const char of text) {
    await locator.pressSequentially(char, { delay: 0 });
    await sleep(keyDelay());
  }
}
