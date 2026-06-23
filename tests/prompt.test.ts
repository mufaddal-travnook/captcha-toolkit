import { describe, expect, it } from 'vitest';
import { buildSolvePrompt } from '../src/features/captcha-solver/prompt.js';

describe('buildSolvePrompt', () => {
  it('includes the target number when provided', () => {
    const p = buildSolvePrompt({ grid: { rows: 3, cols: 3 }, targetNumber: '447' });
    expect(p).toContain('"447"');
    expect(p).toContain('3x3');
    expect(p).toContain('exactly 9 entries');
  });

  it('asks the model to read the target from the image when omitted', () => {
    const p = buildSolvePrompt({ grid: { rows: 3, cols: 3 } });
    expect(p.toLowerCase()).toContain('read the target number from the prompt text');
  });
});
