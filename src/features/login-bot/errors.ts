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
  override readonly name = 'RetryableError';
}

export interface RetryOptions {
  retries: number;
  backoffMs: number;
  /** Optional hook called before each retry (e.g. to reload the captcha). */
  onRetry?: (attempt: number, err: unknown) => Promise<void> | void;
  /** Sleep function (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying on RetryableError with exponential backoff. FatalError (or
 * any non-retryable throw) propagates immediately without retrying.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof FatalError) throw err;
      lastErr = err;
      if (attempt === opts.retries) break;
      await opts.onRetry?.(attempt + 1, err);
      await sleep(opts.backoffMs * 2 ** attempt);
    }
  }
  throw lastErr;
}
