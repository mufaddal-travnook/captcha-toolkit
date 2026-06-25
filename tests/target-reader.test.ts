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

describe('pickBestRead', () => {
  it('prefers a read matching the target length', () => {
    expect(pickBestRead(['43', '343', '3'], 3)).toBe('343');
  });

  it('votes by frequency when multiple match the length', () => {
    expect(pickBestRead(['343', '343', '345'], 3)).toBe('343');
  });

  it('falls back to longest when none match the length', () => {
    expect(pickBestRead(['4', '43', '3'], 3)).toBe('43');
  });

  it('returns empty when all reads are empty', () => {
    expect(pickBestRead(['', ''], 3)).toBe('');
  });
});
