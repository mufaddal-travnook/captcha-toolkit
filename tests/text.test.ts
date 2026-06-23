import { describe, expect, it } from 'vitest';
import { digitsOnly, isMatch } from '../src/core/text.js';

describe('text normalization', () => {
  it('strips non-digits', () => {
    expect(digitsOnly('4 4 7\n')).toBe('447');
    expect(digitsOnly('  487  ')).toBe('487');
    expect(digitsOnly('abc')).toBe('');
  });

  it('matches only on equal digit strings', () => {
    expect(isMatch('4 4 7', '447')).toBe(true);
    expect(isMatch('487', '447')).toBe(false);
    expect(isMatch('', '447')).toBe(false);
  });
});
