/**
 * Click helpers that wait for stability and dismiss loaders before acting, to
 * avoid race-condition timeouts (spinner/overlay intercepting the click).
 */
import type { Frame, Locator, Page } from 'playwright';
import { humanMouseMove, humanPause, keyDelay, preActionJitter, randInt, sleep } from './human.js';

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
 * Click an element the way a person would: move the cursor to it along a real,
 * eased path (not a teleport), small pause, then press at the element's center.
 * Generates genuine mousemove entropy that hover()+click() does not.
 */
export async function humanClick(page: Page, locator: Locator): Promise<void> {
  await locator.waitFor({ state: 'visible' });
  await locator.scrollIntoViewIfNeeded().catch(() => {});

  const box = await locator.boundingBox();
  if (!box) {
    // Fallback if we can't get geometry.
    await locator.click();
    return;
  }
  // Aim for a random point near the center (humans don't hit dead-center).
  const tx = box.x + box.width / 2 + randInt(-Math.floor(box.width / 5), Math.floor(box.width / 5));
  const ty = box.y + box.height / 2 + randInt(-Math.floor(box.height / 4), Math.floor(box.height / 4));

  await humanMouseMove(page.mouse, Math.round(tx), Math.round(ty));
  await sleep(randInt(60, 180));
  await page.mouse.down();
  await sleep(randInt(40, 110)); // realistic press duration
  await page.mouse.up();
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
