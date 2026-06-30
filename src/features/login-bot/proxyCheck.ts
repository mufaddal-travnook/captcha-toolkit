/**
 * Pre-flight proxy reachability check.
 *
 * When routing through an SSH/SOCKS tunnel (EC2 -> home IP), the tunnel can be
 * down at run time. Rather than failing later with a confusing 403 / "no
 * redirect", we verify the proxy works first by fetching an IP-echo URL THROUGH
 * the same proxy and confirming we get a response (and see the exit IP).
 *
 * Uses a short-lived Playwright context with the proxy, so the check exercises
 * the exact path the bot will use.
 */
import { chromium } from 'playwright-extra';
import type { Browser } from 'playwright';

export interface ProxyCheckResult {
  ok: boolean;
  ip?: string;
  error?: string;
}

/**
 * Returns the exit IP seen through `proxyServer`, or an error if the proxy is
 * unreachable. `timeoutMs` bounds the whole check.
 */
export async function checkProxy(
  proxyServer: string,
  timeoutMs = 15_000,
): Promise<ProxyCheckResult> {
  let browser: Browser | undefined;
  try {
    browser = (await chromium.launch({
      headless: true,
      proxy: { server: proxyServer },
    })) as unknown as Browser;

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const resp = await page.goto('https://api.ipify.org', {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    const ip = (await page.textContent('body').catch(() => ''))?.trim() ?? '';
    const ok = Boolean(resp && resp.ok() && /\d+\.\d+\.\d+\.\d+/.test(ip));
    return ok ? { ok: true, ip } : { ok: false, error: `unexpected response: "${ip.slice(0, 60)}"` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await browser?.close().catch(() => {});
  }
}
