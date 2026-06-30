/**
 * Message templating — loads a plain-text template file and substitutes
 * {{placeholder}} tokens. Templates live in ./templates/*.txt so they can be
 * edited freely without touching code.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'templates');

/** Which built-in template to render. */
export type TemplateName = 'slot-available' | 'bot-blocked' | 'error';

/** Values substituted into {{placeholders}}. Anything missing → "". */
export type TemplateVars = Record<string, string | undefined>;

/** Load a template's raw text. `path` overrides the built-in location. */
export async function loadTemplate(name: TemplateName, path?: string): Promise<string> {
  const file = path ?? join(TEMPLATE_DIR, `${name}.txt`);
  return readFile(file, 'utf8');
}

/**
 * Substitute {{key}} tokens with values. Unknown tokens become "" so a stray
 * placeholder never leaks into the message. Whitespace inside braces is allowed.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '');
}

/** Convenience: load + render in one call. */
export async function renderNamed(
  name: TemplateName,
  vars: TemplateVars,
  path?: string,
): Promise<string> {
  const tpl = await loadTemplate(name, path);
  return renderTemplate(tpl, vars).trim();
}
