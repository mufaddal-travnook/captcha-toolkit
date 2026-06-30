/**
 * notifier feature — independent, configurable notifications (currently
 * Telegram). Templates live in ./templates/*.txt and are editable without
 * touching code.
 *
 * Designed to be SAFE to call unconditionally:
 *  - if Telegram isn't configured, the notifier is disabled and all calls no-op
 *  - send failures are swallowed (logged), never crashing the caller
 *
 * Credentials (from .env): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */
import { renderNamed, type TemplateName, type TemplateVars } from './template.js';
import { sendTelegramMessage, type TelegramConfig } from './telegram.js';

export interface NotifierOptions {
  enabled?: boolean;
  telegram?: Partial<TelegramConfig>;
  /** Optional override dir/paths for templates (per-name). */
  templatePaths?: Partial<Record<TemplateName, string>>;
  /** Sink for diagnostic lines (defaults to console.log). */
  log?: (msg: string) => void;
}

export interface Notifier {
  readonly enabled: boolean;
  /** Send a rendered template by name with the given variables. */
  notify(name: TemplateName, vars: TemplateVars): Promise<void>;
}

/** Build a notifier from explicit options + environment fallbacks. */
export function createNotifier(opts: NotifierOptions = {}): Notifier {
  const botToken = opts.telegram?.botToken ?? process.env.TELEGRAM_BOT_TOKEN ?? '';
  const chatId = opts.telegram?.chatId ?? process.env.TELEGRAM_CHAT_ID ?? '';
  const log = opts.log ?? ((m: string) => console.log(m));

  const configured = Boolean(botToken && chatId);
  const enabled = (opts.enabled ?? true) && configured;

  if ((opts.enabled ?? true) && !configured) {
    log('Notifier: Telegram not configured (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID). Notifications disabled.');
  }

  const tg: TelegramConfig = {
    botToken,
    chatId,
    timeoutMs: opts.telegram?.timeoutMs,
    retries: opts.telegram?.retries,
    disablePreview: opts.telegram?.disablePreview,
  };

  return {
    enabled,
    async notify(name, vars) {
      if (!enabled) return;
      try {
        const text = await renderNamed(name, withDefaults(vars), opts.templatePaths?.[name]);
        const res = await sendTelegramMessage(tg, text);
        if (res.ok) log(`Notifier: sent "${name}" to Telegram.`);
        else log(`Notifier: failed to send "${name}" — ${res.error ?? 'unknown'}.`);
      } catch (err) {
        log(`Notifier: error rendering/sending "${name}" — ${err instanceof Error ? err.message : err}.`);
      }
    },
  };
}

/** Fill common variables (timestamp) if the caller didn't provide them. */
function withDefaults(vars: TemplateVars): TemplateVars {
  return { timestamp: vars.timestamp ?? new Date().toISOString(), ...vars };
}

export type { TemplateName, TemplateVars } from './template.js';
export { renderTemplate, renderNamed } from './template.js';
