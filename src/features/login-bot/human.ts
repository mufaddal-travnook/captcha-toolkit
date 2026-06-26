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
