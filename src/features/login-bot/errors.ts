/**
 * Error taxonomy + retry runner.
 *
 * FatalError  -> stop immediately (geo-block, bad creds, missing config). A
 *                retry can't help.
 * RetryableError -> transient (nav timeout, stale element, captcha miss). Retry
 *                with exponential backoff.
 */

export class FatalError extends Error {
  override readonly name = 'FatalError';
}

export class RetryableError extends Error {
  override readonly name: string = 'RetryableError';
}

/** Why a captcha attempt failed — drives how (and whether) we retry. */
export type CaptchaFailureReason =
  | 'IFRAME_NOT_READY' // frame/grid not loaded yet → just wait + retry (no reload, no API call wasted)
  | 'WRONG_TILE_COUNT' // resolved ≠ 9 active slots → reload + retry
  | 'NO_MATCHES' // model returned 0 matching tiles → reload + retry
  | 'VERIFY_TIMEOUT'; // clicked+submitted but "Verified!" never appeared → reload + retry (longer verify wait)

/** A retryable captcha failure tagged with a reason code. */
export class CaptchaError extends RetryableError {
  override readonly name = 'CaptchaError';
  constructor(
    readonly reason: CaptchaFailureReason,
    message: string,
  ) {
    super(message);
  }
}

export interface RetryOptions {
  retries: number;
  backoffMs: number;
  /**
   * Optional hook before each retry (e.g. reload the captcha). Returns the ms to
   * wait before the next attempt; if it returns undefined, the default
   * jittered exponential backoff is used.
   */
  onRetry?: (attempt: number, err: unknown) => Promise<number | void> | number | void;
  /** Add ±25% random jitter to the backoff so timing isn't robotic. Default true. */
  jitter?: boolean;
  /** Sleep function (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Random source 0..1 (injectable for tests). Defaults to Math.random. */
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with optional ±25% jitter. */
export function backoffDelay(
  base: number,
  attempt: number,
  jitter = true,
  random: () => number = Math.random,
): number {
  const raw = base * 2 ** attempt;
  if (!jitter) return raw;
  const factor = 0.75 + random() * 0.5; // 0.75 .. 1.25
  return Math.round(raw * factor);
}

/**
 * Run `fn`, retrying on RetryableError with (jittered) exponential backoff.
 * FatalError (or any non-retryable throw) propagates immediately. `onRetry` may
 * return an explicit delay (ms) to override the computed backoff for that retry.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const jitter = opts.jitter ?? true;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof FatalError) throw err;
      lastErr = err;
      if (attempt === opts.retries) break;
      const override = await opts.onRetry?.(attempt + 1, err);
      const delay =
        typeof override === 'number' ? override : backoffDelay(opts.backoffMs, attempt, jitter, random);
      await sleep(delay);
    }
  }
  throw lastErr;
}
