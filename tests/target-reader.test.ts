import { describe, expect, it } from 'vitest';
import { extractTargetNumber } from '../src/features/captcha-solver/targetReader.js';
import { pickBestRead } from '../src/features/captcha-solver/OcrSolver.js';

describe('extractTargetNumber', () => {
  it('pulls the first 3-digit number from instruction text', () => {
    expect(extractTargetNumber('Please select all boxes with number 343')).toBe('343');
    expect(extractTargetNumber('select number 447 now')).toBe('447');
  });

  it('respects the requested digit length', () => {
    expect(extractTargetNumber('code 12 then 9876', 4)).toBe('9876');
  });

  it('returns undefined when no number of that length exists', () => {
    expect(extractTargetNumber('no digits here')).toBeUndefined();
  });
});

const r = (text: string, confidence = 50) => ({ text, confidence });

describe('pickBestRead', () => {
  it('prefers a read matching the target length', () => {
    expect(pickBestRead([r('43'), r('343'), r('3')], 3)).toBe('343');
  });

  it('weights by confidence, not just frequency', () => {
    // "833" appears twice but at low confidence; "855" is higher-confidence.
    const reads = [r('833', 63), r('833', 63), r('855', 84), r('855', 84)];
    expect(pickBestRead(reads, 3)).toBe('855');
  });

  it('falls back to longest when none match the length', () => {
    expect(pickBestRead([r('4'), r('43'), r('3')], 3)).toBe('43');
  });

  it('returns empty when all reads are empty', () => {
    expect(pickBestRead([r(''), r('')], 3)).toBe('');
  });
});
