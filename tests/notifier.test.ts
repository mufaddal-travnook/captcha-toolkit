import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../src/features/notifier/template.js';
import { createNotifier } from '../src/features/notifier/index.js';

describe('renderTemplate', () => {
  it('substitutes {{placeholders}}', () => {
    const out = renderTemplate('Hi {{name}}, loc {{location}}', { name: 'Bob', location: 'Dubai' });
    expect(out).toBe('Hi Bob, loc Dubai');
  });

  it('tolerates whitespace in braces', () => {
    expect(renderTemplate('{{ a }}-{{b}}', { a: '1', b: '2' })).toBe('1-2');
  });

  it('replaces unknown tokens with empty string', () => {
    expect(renderTemplate('x={{missing}}y', {})).toBe('x=y');
  });
});

describe('createNotifier', () => {
  it('is disabled when no credentials are present', () => {
    const logs: string[] = [];
    const n = createNotifier({
      telegram: { botToken: '', chatId: '' },
      log: (m) => logs.push(m),
    });
    expect(n.enabled).toBe(false);
  });

  it('notify() is a safe no-op when disabled', async () => {
    const n = createNotifier({ telegram: { botToken: '', chatId: '' }, log: () => {} });
    await expect(n.notify('error', { message: 'x' })).resolves.toBeUndefined();
  });

  it('reports enabled when credentials are provided', () => {
    const n = createNotifier({ telegram: { botToken: 't', chatId: 'c' }, log: () => {} });
    expect(n.enabled).toBe(true);
  });
});
