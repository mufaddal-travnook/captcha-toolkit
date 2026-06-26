/**
 * Human-like timing helpers — randomized delays and jitter so the bot doesn't
 * act with robotic, constant-interval precision (which bot detectors flag).
 *
 * Math.random() is used here intentionally for non-deterministic, human-like
 * variance; this code runs only in the live CLI, never in tests.
 */

/** Sleep for a fixed number of ms. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Random integer in [min, max]. */
export function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/** Sleep a random duration in [min, max] ms — a "human pause". */
export function humanPause(min = 400, max = 1200): Promise<void> {
  return sleep(randInt(min, max));
}

/**
 * A per-keystroke delay generator: base typing speed with occasional longer
 * pauses (as if thinking), so typing cadence isn't perfectly uniform.
 */
export function keyDelay(): number {
  // ~12% of keystrokes get a longer "hesitation".
  if (Math.random() < 0.12) return randInt(180, 380);
  return randInt(45, 130);
}

/** Small randomized mouse-move-then-pause jitter before an action. */
export async function preActionJitter(): Promise<void> {
  await sleep(randInt(120, 450));
}

/** A point on screen. */
export interface Point {
  x: number;
  y: number;
}

// Track the virtual cursor position across moves (Playwright has no getter).
let cursor: Point = { x: 200, y: 200 };

/**
 * Move the mouse to (toX, toY) along a curved, eased, multi-step path with a
 * little jitter and a slight overshoot-then-settle — much closer to real human
 * motion than a single teleport. Updates the tracked cursor position.
 */
export async function humanMouseMove(
  mouse: { move: (x: number, y: number, opts?: { steps?: number }) => Promise<void> },
  toX: number,
  toY: number,
): Promise<void> {
  const from = cursor;
  const dist = Math.hypot(toX - from.x, toY - from.y);
  const steps = Math.max(8, Math.min(40, Math.round(dist / 12)));

  // A control point offset to one side gives a gentle curve (quadratic Bézier).
  const midX = (from.x + toX) / 2 + randInt(-40, 40);
  const midY = (from.y + toY) / 2 + randInt(-40, 40);

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = t * t * (3 - 2 * t); // smoothstep easing
    // Quadratic Bézier through the control point.
    const x =
      (1 - ease) ** 2 * from.x + 2 * (1 - ease) * ease * midX + ease ** 2 * toX + randInt(-1, 1);
    const y =
      (1 - ease) ** 2 * from.y + 2 * (1 - ease) * ease * midY + ease ** 2 * toY + randInt(-1, 1);
    await mouse.move(Math.round(x), Math.round(y));
    await sleep(randInt(6, 18));
  }
  // Tiny settle so we don't land pixel-perfect-instant.
  await mouse.move(toX, toY);
  cursor = { x: toX, y: toY };
}

