/**
 * Browser lifecycle — launch a fresh stealth Chrome and guarantee teardown so
 * no zombie processes survive a run (important for cron/repeat use).
 *
 * Uses playwright-extra + puppeteer-extra-plugin-stealth to hide automation
 * signals (navigator.webdriver, headless markers, etc.) for a legitimate login.
 *
 * Launches a PERSISTENT context (a real on-disk user-data-dir), so cookies,
 * localStorage and session state survive across runs — like a normal browser
 * profile. This avoids re-logging-in every run.
 */
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { BrowserContext, Page } from 'playwright';

// Apply stealth evasions once.
chromium.use(StealthPlugin());

export interface LaunchedBrowser {
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export interface LaunchOptions {
  headed: boolean;
  timeoutMs: number;
  /** Profile directory for the persistent context. Defaults to a temp profile. */
  userDataDir?: string;
  /** Route all traffic through this proxy, e.g. "socks5://localhost:1080". */
  proxyServer?: string;
}

export async function launchBrowser(opts: LaunchOptions): Promise<LaunchedBrowser> {
  const userDataDir = opts.userDataDir ?? join(tmpdir(), 'bls-login-bot-profile');

  // Proxy (optional) — e.g. an SSH SOCKS tunnel that egresses via your home IP.
  const proxy = opts.proxyServer ? { server: opts.proxyServer } : undefined;

  // launchPersistentContext returns the CONTEXT directly (no separate browser).
  const context = (await chromium.launchPersistentContext(userDataDir, {
    headless: !opts.headed,
    viewport: null, // use the real window size
    locale: 'en-US',
    ...(proxy ? { proxy } : {}),
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
  })) as unknown as BrowserContext;

  context.setDefaultTimeout(opts.timeoutMs);

  // A persistent context already has an initial page; reuse it (or open one).
  const page = context.pages()[0] ?? (await context.newPage());

  const close = async (): Promise<void> => {
    // Best-effort teardown; never throw from cleanup. Closing the persistent
    // context also closes the underlying browser process.
    await context.close().catch(() => {});
  };

  return { context, page, close };
}
