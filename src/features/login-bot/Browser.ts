/**
 * Browser lifecycle — launch a fresh stealth Chrome and guarantee teardown so
 * no zombie processes survive a run (important for cron/repeat use).
 *
 * Uses playwright-extra + puppeteer-extra-plugin-stealth to hide automation
 * signals (navigator.webdriver, headless markers, etc.) for a legitimate login.
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser as PWBrowser, BrowserContext, Page } from 'playwright';

// Apply stealth evasions once.
chromium.use(StealthPlugin());

export interface LaunchedBrowser {
  browser: PWBrowser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export interface LaunchOptions {
  headed: boolean;
  timeoutMs: number;
}

export async function launchBrowser(opts: LaunchOptions): Promise<LaunchedBrowser> {
  const browser = (await chromium.launch({
    headless: !opts.headed,
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
  })) as unknown as PWBrowser;

  const context = await browser.newContext({
    viewport: null, // use the real window size
    locale: 'en-US',
  });
  context.setDefaultTimeout(opts.timeoutMs);

  const page = await context.newPage();

  const close = async (): Promise<void> => {
    // Best-effort teardown; never throw from cleanup.
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  };

  return { browser, context, page, close };
}
