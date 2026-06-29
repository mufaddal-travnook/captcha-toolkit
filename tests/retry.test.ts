import { describe, expect, it, vi } from 'vitest';
import {
  withRetry,
  backoffDelay,
  FatalError,
  RetryableError,
  CaptchaError,
} from '../src/features/login-bot/errors.js';

const noSleep = async (): Promise<void> => {};

describe('backoffDelay', () => {
  it('grows exponentially without jitter', () => {
    expect(backoffDelay(1000, 0, false)).toBe(1000);
    expect(backoffDelay(1000, 1, false)).toBe(2000);
    expect(backoffDelay(1000, 2, false)).toBe(4000);
  });

  it('applies ±25% jitter from the random source', () => {
    expect(backoffDelay(1000, 0, true, () => 0)).toBe(750); // factor 0.75
    expect(backoffDelay(1000, 0, true, () => 1)).toBe(1250); // factor 1.25
    expect(backoffDelay(1000, 0, true, () => 0.5)).toBe(1000); // factor 1.0
  });
});

describe('withRetry', () => {
  it('returns immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    expect(await withRetry(fn, { retries: 3, backoffMs: 10, sleep: noSleep })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries RetryableError up to `retries` then throws', async () => {
    const fn = vi.fn().mockRejectedValue(new RetryableError('nope'));
    await expect(withRetry(fn, { retries: 2, backoffMs: 1, sleep: noSleep })).rejects.toThrow('nope');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('does NOT retry FatalError', async () => {
    const fn = vi.fn().mockRejectedValue(new FatalError('stop'));
    await expect(withRetry(fn, { retries: 3, backoffMs: 1, sleep: noSleep })).rejects.toThrow('stop');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('succeeds after transient failures', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RetryableError('a'))
      .mockRejectedValueOnce(new RetryableError('b'))
      .mockResolvedValue('done');
    expect(await withRetry(fn, { retries: 3, backoffMs: 1, sleep: noSleep })).toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('uses an onRetry-returned delay over the computed backoff', async () => {
    const sleeps: number[] = [];
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RetryableError('x'))
      .mockResolvedValue('y');
    await withRetry(fn, {
      retries: 2,
      backoffMs: 1000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      onRetry: () => 42, // fixed override
    });
    expect(sleeps).toEqual([42]);
  });

  it('passes the thrown error (incl. CaptchaError reason) to onRetry', async () => {
    const reasons: string[] = [];
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new CaptchaError('NO_MATCHES', 'no match'))
      .mockResolvedValue('ok');
    await withRetry(fn, {
      retries: 2,
      backoffMs: 1,
      sleep: noSleep,
      onRetry: (_n, err) => {
        reasons.push(err instanceof CaptchaError ? err.reason : 'other');
      },
    });
    expect(reasons).toEqual(['NO_MATCHES']);
  });
});
