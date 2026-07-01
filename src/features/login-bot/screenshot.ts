/**
 * Debug screenshots — capture the page so failures can be diagnosed after the
 * fact (especially on a headless/xvfb server you can't see).
 *
 * Each shot has a SEVERITY, and the shooter has a LEVEL. A shot is written only
 * if its severity is important enough for the current level:
 *
 *   level 'error'  → only 'error' shots            (quiet: failures + blocks)
 *   level 'result' → 'error' + 'result' shots      (outcomes + failures)
 *   level 'all'    → every shot                     (full step-by-step debug)
 *   level 'off'    → nothing
 *
 * Files are written FLAT into ./screenshots (no subfolders). Filenames are
 * timestamped so runs sort chronologically, e.g.
 *   screenshots/143012-001-result-abu-dhabi-....png
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';

/** How important a given screenshot is. */
export type ShotSeverity = 'error' | 'result' | 'step';
/** How much the run wants captured. */
export type ScreenshotLevel = 'off' | 'error' | 'result' | 'all';

export interface Shooter {
  readonly enabled: boolean;
  readonly level: ScreenshotLevel;
  /**
   * Capture the current page, tagged with `label`. `severity` defaults to
   * 'step' (routine). Skipped silently if the level doesn't want it. Never throws.
   */
  shot: (page: Page, label: string, severity?: ShotSeverity) => Promise<void>;
  /** Directory screenshots are written to. */
  readonly dir: string;
}

export interface ShooterOptions {
  /** How much to capture. Back-compat: `enabled` maps to 'all'/'off' if level unset. */
  level?: ScreenshotLevel;
  /** Deprecated boolean form; ignored if `level` is given. */
  enabled?: boolean;
  /** Directory for screenshots (flat, no subfolders). Defaults to ./screenshots. */
  baseDir?: string;
  /** Full-page screenshot (vs just the viewport). */
  fullPage?: boolean;
  /** Diagnostic sink. */
  log?: (msg: string) => void;
}

/** Severities allowed to write at each level. */
const ALLOWED: Record<ScreenshotLevel, Set<ShotSeverity>> = {
  off: new Set(),
  error: new Set(['error']),
  result: new Set(['error', 'result']),
  all: new Set(['error', 'result', 'step']),
};

/** Build a screenshot helper. Level 'off' → all calls no-op. */
export function createShooter(opts: ShooterOptions): Shooter {
  const level: ScreenshotLevel = opts.level ?? (opts.enabled === false ? 'off' : 'all');
  const dir = opts.baseDir ?? 'screenshots';
  const log = opts.log ?? (() => {});
  const allowed = ALLOWED[level];
  let seq = 0;
  let dirReady: Promise<void> | null = null;

  const shot = async (page: Page, label: string, severity: ShotSeverity = 'step'): Promise<void> => {
    if (!allowed.has(severity)) return;
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

  return { enabled: level !== 'off', level, shot, dir };
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
