/**
 * Telegram transport — sends a message via the Bot API (sendMessage).
 *
 * Uses global fetch (Node >= 18). Credentials come from .env:
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 *
 * Robustness: per-send timeout + a few retries with backoff, so a flaky network
 * never crashes the main automation. Failures are reported, not thrown.
 */
export interface TelegramConfig {
  botToken: string;
  chatId: string;
  /** Per-request timeout (ms). */
  timeoutMs?: number;
  /** Retry attempts on transient failure. */
  retries?: number;
  /** Disable Telegram's link preview (cleaner messages). */
  disablePreview?: boolean;
}

export interface SendResult {
  ok: boolean;
  status?: number;
  error?: string;
}

const API = 'https://api.telegram.org';

/** Send a plain-text message. Never throws; returns {ok}. */
export async function sendTelegramMessage(
  cfg: TelegramConfig,
  text: string,
): Promise<SendResult> {
  const url = `${API}/bot${cfg.botToken}/sendMessage`;
  const body = {
    chat_id: cfg.chatId,
    text,
    disable_web_page_preview: cfg.disablePreview ?? false,
  };
  const retries = cfg.retries ?? 2;
  const timeoutMs = cfg.timeoutMs ?? 10_000;

  let lastErr = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (res.ok) return { ok: true, status: res.status };
      // 4xx (bad token/chat) won't fix on retry — stop early.
      lastErr = `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`;
      if (res.status >= 400 && res.status < 500) return { ok: false, status: res.status, error: lastErr };
    } catch (err) {
      clearTimeout(t);
      lastErr = err instanceof Error ? err.message : String(err);
    }
    if (attempt < retries) await sleep(800 * 2 ** attempt);
  }
  return { ok: false, error: lastErr };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
