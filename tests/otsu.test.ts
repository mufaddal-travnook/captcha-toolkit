import { describe, expect, it } from 'vitest';
import { histogram, otsuThreshold } from '../src/core/otsu.js';

describe('otsu', () => {
  it('builds a histogram', () => {
    const h = histogram(Uint8Array.from([0, 0, 255, 128]));
    expect(h[0]).toBe(2);
    expect(h[128]).toBe(1);
    expect(h[255]).toBe(1);
  });

  it('finds a threshold that separates two classes', () => {
    // Half pixels near 20, half near 200. Otsu returns t where the low class is
    // <= t and the high class is > t; t lands at/just below the high cluster.
    const data = Uint8Array.from([
      ...Array(50).fill(20),
      ...Array(50).fill(200),
    ]);
    const t = otsuThreshold(data);
    // Everything in the low cluster is <= t, everything in the high cluster is > t.
    expect(20).toBeLessThanOrEqual(t);
    expect(t).toBeLessThan(200);
  });

  it('returns a default for empty input', () => {
    expect(otsuThreshold(new Uint8Array())).toBe(127);
  });
});
