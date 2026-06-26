/**
 * CaptchaBridge — connects the live captcha iframe to our captcha-solver.
 *
 * Flow:
 *   1. enter the captcha iframe
 *   2. screenshot the WHOLE captcha (prompt text + 3x3 grid) — one image
 *   3. OpenAI reads the target number AND the grid from the screenshot, and we
 *      compute which cells match -> matches[] (indexes 0-8 in DOM/reading order)
 *   4. click each matching tile element by index (fires the site's Select())
 *   5. submit; success = "Verified!" message appears
 *   On failure: caller reloads images and retries.
 *
 * No DOM prompt-reading: the page renders ~30 decoy "number NNN" labels, so we
 * let the model read the real target straight from the visible pixels instead.
 */
import type { Frame, Page } from 'playwright';
import { createSolver } from '../captcha-solver/index.js';
import type { SolverName } from '../../core/types.js';
import type { Selectors } from './config.js';
import { RetryableError, withRetry } from './errors.js';
import { createLogger, type Logger } from './logger.js';
import { humanPause } from './human.js';

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

/**
 * Screenshot the whole captcha (prompt text + 3x3 grid) so the model can read
 * the target number and the tiles from one image.
 *
 * The active set (prompt + 9 tiles) is painted ON TOP of the stacked decoys, so
 * a screenshot of the main container shows exactly the active, user-visible
 * captcha. We screenshot `#captcha-main-div`; if that fails, capture from the
 * bounding box of the active tiles' container.
 */
async function screenshotCaptcha(frame: Frame, selectors: Selectors): Promise<Buffer> {
  const mainDiv = frame.locator(selectors.captchaMainDiv).first();
  if (await mainDiv.count().then((c) => c > 0).catch(() => false)) {
    const shot = await mainDiv.screenshot().catch(() => null);
    if (shot) return shot;
  }
  // Fallback: the main-div container in the frame body.
  return frame.locator('body').first().screenshot();
}

interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface TileSlot {
  /** Page-absolute pixel center (frame offset + in-frame center). */
  pageX: number;
  pageY: number;
}

/**
 * Resolve the 9 active grid slots by screen position. Among all stacked tiles,
 * group by rounded (x,y) center; for each unique slot keep the LAST tile in DOM
 * order (painted on top = the clickable one). Return the 9 slots in reading
 * order (top-to-bottom, then left-to-right) as PAGE-absolute click coords.
 */
async function resolveActiveTiles(frame: Frame, tileSelector: string): Promise<TileSlot[]> {
  // In-frame centers of the topmost tile per slot. Runs in the browser, where
  // `document` exists; typed loosely since the project targets Node (no DOM lib).
  const evalFn = (sel: string): { x: number; y: number }[] => {
    // @ts-expect-error browser globals available at runtime inside evaluate()
    const tiles = Array.from(document.querySelectorAll(sel)) as Array<{
      getBoundingClientRect: () => DOMRectLike;
    }>;
    const bySlot = new Map<string, { x: number; y: number; order: number }>();
    tiles.forEach((t, order) => {
      const r = t.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const key = `${Math.round(cx / 20)}:${Math.round(cy / 20)}`;
      const prev = bySlot.get(key);
      if (!prev || order > prev.order) bySlot.set(key, { x: cx, y: cy, order });
    });
    return Array.from(bySlot.values())
      .sort((a, b) => (Math.abs(a.y - b.y) > 10 ? a.y - b.y : a.x - b.x))
      .map(({ x, y }) => ({ x, y }));
  };
  const inFrame = await frame.evaluate(evalFn, tileSelector);

  // Add the iframe's page offset so clicks land in page coordinates.
  const frameEl = await frame.frameElement();
  const box = await frameEl.boundingBox();
  const offX = box?.x ?? 0;
  const offY = box?.y ?? 0;
  return inFrame.map((p) => ({ pageX: Math.round(offX + p.x), pageY: Math.round(offY + p.y) }));
}

export async function solveCaptcha(
  page: Page,
  selectors: Selectors,
  solverName: SolverName,
  log: Logger = createLogger(),
): Promise<CaptchaResult> {
  const frame = await getCaptchaFrame(page, selectors.captchaFrame);
  log.info('Entered captcha iframe.');

  // 1. Anti-bot trick: the page stacks MANY tile sets at the SAME 9 screen
  //    positions (decoys underneath the active one). DOM order is unreliable,
  //    so we resolve the 9 grid slots by SCREEN POSITION: group every tile by
  //    its (x,y) center, and for each of the 9 slots keep the TOPMOST tile
  //    (highest in paint order = what the user sees & clicks). Order the 9 slots
  //    in reading order (row-major) so index 0-8 matches the screenshot.
  await frame.locator(selectors.tileImage).last().waitFor({ state: 'attached' });
  const slots = await resolveActiveTiles(frame, selectors.tileImage);
  if (slots.length !== 9) {
    throw new RetryableError(`Expected 9 grid slots, resolved ${slots.length}.`);
  }
  log.info(`Resolved 9 active tile slots by screen position.`);

  // Screenshot the active grid + its prompt so the model reads the target.
  const captchaImage = await screenshotCaptcha(frame, selectors);
  log.info(`Captured captcha (${captchaImage.length} bytes) for solving.`);

  // 2. one OpenAI call: the model reads the target AND the grid; we get matches.
  const solver = createSolver(solverName, {
    openai: { onRawResponse: (raw) => log.info(`AI raw response: ${raw.replace(/\s+/g, ' ').trim()}`) },
  });
  const solution = await solver.solve({ image: captchaImage }); // no target hint — model reads it
  const target = solution.targetNumber;
  const readValues = solution.cells.map((c) => c.value || '∅').join(', ');
  log.info(`AI target number: ${target}`);
  log.info(`AI parsed values: [${readValues}]`);
  log.info(`AI matches (indexes 0-8): [${solution.matches.join(', ')}]`);

  if (solution.matches.length === 0) {
    throw new RetryableError(`Solver found no tiles matching ${target}.`);
  }

  // 3. click each matching slot BY COORDINATE inside the frame. Clicking the
  //    pixel hits whatever is painted on top there — i.e. the active tile —
  //    sidestepping the stacked decoys entirely.
  for (const index of solution.matches) {
    const slot = slots[index];
    if (!slot) continue;
    await humanPause(150, 400);
    await page.mouse.move(slot.pageX, slot.pageY, { steps: 4 });
    await page.mouse.click(slot.pageX, slot.pageY);
    log.info(`Clicked slot #${index} at (${slot.pageX}, ${slot.pageY}).`);
    await humanPause(350, 900);
  }

  // 4. submit selection. Like the tiles, action controls may be stacked per
  //    set — the active one is last/on-top, so use last() + force.
  await humanPause(500, 1100); // review the selection before submitting
  log.step('Clicking Submit Selection…');
  await frame.locator(selectors.submitSelection).last().click({ force: true });

  // 5. success = "Verified!" message becomes visible.
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
  await frame.locator(selectors.reloadButton).last().click({ force: true }).catch(() => {});
}

/**
 * Solve the captcha with retry + reload. Shared by BOTH the login captcha and
 * the dashboard captcha (identical DOM). `label` just tags the log lines.
 */
export async function solveCaptchaWithRetry(
  page: Page,
  selectors: Selectors,
  solverName: SolverName,
  opts: { retries: number; backoffMs: number; label?: string },
  log: Logger = createLogger(),
): Promise<CaptchaResult> {
  const tag = opts.label ? `${opts.label} ` : '';
  let attempt = 0;
  return withRetry(
    async () => {
      attempt++;
      log.step(`Solving ${tag}captcha (attempt ${attempt}) via '${solverName}' solver…`);
      const result = await solveCaptcha(page, selectors, solverName, log);
      if (!result.verified) {
        throw new RetryableError(`Captcha not verified (target ${result.target}).`);
      }
      log.info(`${tag}captcha verified ✓ (target ${result.target}).`);
      return result;
    },
    {
      retries: opts.retries,
      backoffMs: opts.backoffMs,
      onRetry: async (n, err) => {
        log.warn(`Captcha attempt failed: ${err instanceof Error ? err.message : err}`);
        log.step(`Reloading images before retry ${n}…`);
        await reloadCaptcha(page, selectors).catch(() => {});
      },
    },
  );
}
