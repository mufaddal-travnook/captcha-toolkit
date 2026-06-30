/**
 * Debug screenshots — capture the page at major steps so failures can be
 * diagnosed after the fact (especially on a headless/xvfb server you can't see).
 *
 * Config-gated: when disabled, `shot()` is a cheap no-op. Files are written to
 * a per-run folder with a zero-padded sequence + slugged label so they sort in
 * order, e.g.  screenshots/2026-06-30_14-22-01/03_login-captcha-solved.png
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';

export interface Shooter {
  readonly enabled: boolean;
  /** Capture the current page, tagged with `label`. Never throws. */
  shot: (page: Page, label: string) => Promise<void>;
  /** Directory screenshots are written to (for logging). */
  readonly dir: string;
}

export interface ShooterOptions {
  enabled: boolean;
  /** Base directory; a per-run subfolder is created under it. */
  baseDir?: string;
  /** Full-page screenshot (vs just the viewport). */
  fullPage?: boolean;
  /** Diagnostic sink. */
  log?: (msg: string) => void;
}

/** Build a screenshot helper. Disabled → all calls no-op. */
export function createShooter(opts: ShooterOptions): Shooter {
  const base = opts.baseDir ?? 'screenshots';
  const runDir = join(base, runStamp());
  const log = opts.log ?? (() => {});
  let seq = 0;
  let dirReady: Promise<void> | null = null;

  const shot = async (page: Page, label: string): Promise<void> => {
    if (!opts.enabled) return;
    try {
      if (!dirReady) dirReady = mkdir(runDir, { recursive: true }).then(() => {});
      await dirReady;
      seq += 1;
      const name = `${String(seq).padStart(2, '0')}_${slug(label)}.png`;
      const file = join(runDir, name);
      await page.screenshot({ path: file, fullPage: opts.fullPage ?? false });
      log(`📸 ${file}`);
    } catch (err) {
      log(`Screenshot failed (${label}): ${err instanceof Error ? err.message : err}`);
    }
  };

  return { enabled: opts.enabled, shot, dir: runDir };
}

/** A filesystem-safe timestamp for the run folder. */
function runStamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** Slugify a label for a filename. */
function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}
