/**
 * Click helpers that wait for stability and dismiss loaders before acting, to
 * avoid race-condition timeouts (spinner/overlay intercepting the click).
 */
import type { Frame, Locator, Page } from 'playwright';

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
 */
export async function safeClick(scope: Page | Frame, locator: Locator): Promise<void> {
  await waitForLoadersGone(scope);
  await locator.waitFor({ state: 'visible' });
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click();
}

/** Type into a field like a human (per-character delay), after clearing it. */
export async function humanType(locator: Locator, text: string): Promise<void> {
  await locator.waitFor({ state: 'visible' });
  await locator.click();
  await locator.fill('');
  await locator.pressSequentially(text, { delay: 60 });
}
