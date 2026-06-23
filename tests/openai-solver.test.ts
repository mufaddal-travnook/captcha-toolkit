import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { OpenAiSolver } from '../src/features/captcha-solver/OpenAiSolver.js';

/** Build a blank 300x300 PNG so sharp can read real dimensions. */
async function blankImage(): Promise<Buffer> {
  return sharp({
    create: { width: 300, height: 300, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
}

/** Fake OpenAI client returning a canned vision JSON. */
function fakeClient(values: string[], targetNumber = '447') {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify({ targetNumber, values }) } }],
        }),
      },
    },
  } as unknown as ConstructorParameters<typeof OpenAiSolver>[0]['client'];
}

describe('OpenAiSolver (mocked client)', () => {
  it('matches the sample captcha — 447 in cells 0, 5, 8', async () => {
    const values = ['447', '487', '392', '765', '264', '447', '408', '166', '447'];
    const solver = new OpenAiSolver({ client: fakeClient(values) });

    const solution = await solver.solve({ image: await blankImage(), targetNumber: '447' });

    expect(solution.matches).toEqual([0, 5, 8]);
    expect(solution.solver).toBe('openai');
    expect(solution.cells).toHaveLength(9);
    expect(solution.cells[0]?.center).toEqual({ x: 50, y: 50 });
  });

  it('throws when model returns wrong cell count', async () => {
    const solver = new OpenAiSolver({ client: fakeClient(['447', '487']) });
    await expect(solver.solve({ image: await blankImage(), targetNumber: '447' })).rejects.toThrow(
      /expected 9/,
    );
  });
});
