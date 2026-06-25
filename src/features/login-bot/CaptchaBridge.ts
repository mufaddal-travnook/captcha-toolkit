/**
 * CaptchaBridge — connects the live captcha iframe to our captcha-solver.
 *
 * Flow:
 *   1. enter the captcha iframe
 *   2. read the VISIBLE prompt label -> target number
 *   3. screenshot the grid container (one image, one OpenAI call)
 *   4. solver.solve({ image, target }) -> matches[] (cell indexes)
 *   5. click each matching tile element by index (fires the site's Select())
 *   6. submit; success = "Verified!" message appears
 *   On failure: caller reloads images and retries.
 */
import type { Frame, Page } from 'playwright';
import { createSolver } from '../captcha-solver/index.js';
import type { SolverName } from '../../core/types.js';
import type { Selectors } from './config.js';
import { readVisibleTarget } from './fields.js';
import { safeClick } from './safeClick.js';
import { RetryableError } from './errors.js';
import { createLogger, type Logger } from './logger.js';

export interface CaptchaResult {
  target: string;
  matches: number[];
  verified: boolean;
}

/** Get the captcha iframe's Frame, or throw if not present. */
export async function getCaptchaFrame(page: Page, frameSelector: string): Promise<Frame> {
  const handle = await page.waitForSelector(frameSelector, { state: 'attached' });
  const frame = await handle.contentFrame();
  if (!frame) throw new RetryableError('Captcha iframe present but content frame not ready.');
  return frame;
}

export async function solveCaptcha(
  page: Page,
  selectors: Selectors,
  solverName: SolverName,
  log: Logger = createLogger(),
): Promise<CaptchaResult> {
  const frame = await getCaptchaFrame(page, selectors.captchaFrame);
  log.info('Entered captcha iframe.');

  // 1. target number from the visible prompt label.
  const target = await readVisibleTarget(frame, selectors.promptLabel);
  log.info(`Captcha prompt target number: ${target}`);

  // 2. wait for tiles, screenshot the grid container (single image).
  const tiles = frame.locator(selectors.tileImage);
  await tiles.first().waitFor({ state: 'visible' });
  const tileCount = await tiles.count();
  const gridImage = await frame.locator(selectors.gridContainer).first().screenshot();
  log.info(`Captured grid (${tileCount} tiles, ${gridImage.length} bytes) for solving.`);

  // 3. solve (one OpenAI call for the whole grid).
  const solver = createSolver(solverName);
  const solution = await solver.solve({ image: gridImage, targetNumber: target });
  const readValues = solution.cells.map((c) => c.value || '∅').join(', ');
  log.info(`AI/OCR response → values: [${readValues}]`);
  log.info(`AI/OCR matches for ${target}: [${solution.matches.join(', ')}]`);

  if (solution.matches.length === 0) {
    throw new RetryableError(`Solver found no tiles matching ${target}.`);
  }

  // 4. click each matching tile by index (discrete elements -> Select()).
  for (const index of solution.matches) {
    await safeClick(frame, tiles.nth(index));
    log.info(`Clicked tile #${index}.`);
  }

  // 5. submit selection (by visible text).
  log.step('Clicking Submit Selection…');
  await safeClick(frame, frame.locator(selectors.submitSelection).first());

  // 6. success = "Verified!" message becomes visible.
  const verified = await frame
    .locator(selectors.verifiedMessage)
    .first()
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);

  return { target, matches: solution.matches, verified };
}

/** Click "Reload Images" to fetch a fresh captcha before a retry. */
export async function reloadCaptcha(page: Page, selectors: Selectors): Promise<void> {
  const frame = await getCaptchaFrame(page, selectors.captchaFrame);
  await safeClick(frame, frame.locator(selectors.reloadButton).first());
}
