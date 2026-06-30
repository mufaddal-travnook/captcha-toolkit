/**
 * Debug screenshots — capture the page at major steps so failures can be
 * diagnosed after the fact (especially on a headless/xvfb server you can't see).
 *
 * Config-gated: when disabled, `shot()` is a cheap no-op. All files are written
 * FLAT into ./screenshots (no subfolders). Each filename is timestamped so runs
 * don't collide and they sort chronologically, e.g.
 *   screenshots/143012-001-login-page-loaded.png
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';

export interface Shooter {
  readonly enabled: boolean;
  /** Capture the current page, tagged with `label`. Never throws. */
  shot: (page: Page, label: string) => Promise<void>;
  /** Directory screenshots are written to. */
  readonly dir: string;
}

export interface ShooterOptions {
  enabled: boolean;
  /** Directory for screenshots (flat, no subfolders). Defaults to ./screenshots. */
  baseDir?: string;
  /** Full-page screenshot (vs just the viewport). */
  fullPage?: boolean;
  /** Diagnostic sink. */
  log?: (msg: string) => void;
}

/** Build a screenshot helper. Disabled → all calls no-op. */
export function createShooter(opts: ShooterOptions): Shooter {
  const dir = opts.baseDir ?? 'screenshots';
  const log = opts.log ?? (() => {});
  let seq = 0;
  let dirReady: Promise<void> | null = null;

  const shot = async (page: Page, label: string): Promise<void> => {
    if (!opts.enabled) return;
    try {
      if (!dirReady) dirReady = mkdir(dir, { recursive: true }).then(() => {});
      await dirReady;
      seq += 1;
      const name = `${hhmmss()}-${String(seq).padStart(3, '0')}-${slug(label)}.png`;
      await page.screenshot({ path: join(dir, name), fullPage: opts.fullPage ?? false });
    } catch (err) {
      log(`Screenshot failed (${label}): ${err instanceof Error ? err.message : err}`);
    }
  };

  return { enabled: opts.enabled, shot, dir };
}

/** HHMMSS for the filename prefix. */
function hhmmss(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Slugify a label for a filename. */
function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}
