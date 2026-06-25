/**
 * Tiny step logger for the login bot — timestamped, leveled, with helpers to
 * mask secrets so credentials never land in logs verbatim.
 */
export type LogLevel = 'info' | 'step' | 'warn' | 'error';

export interface Logger {
  info: (msg: string) => void;
  step: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

const ICON: Record<LogLevel, string> = {
  info: 'ℹ',
  step: '▶',
  warn: '⚠',
  error: '✖',
};

function ts(): string {
  // HH:MM:SS local time — Date.now()/new Date() are fine in the CLI runtime.
  return new Date().toTimeString().slice(0, 8);
}

export function createLogger(enabled = true): Logger {
  const emit = (level: LogLevel, msg: string): void => {
    if (!enabled) return;
    const line = `[${ts()}] ${ICON[level]} ${msg}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    info: (m) => emit('info', m),
    step: (m) => emit('step', m),
    warn: (m) => emit('warn', m),
    error: (m) => emit('error', m),
  };
}

/** Mask an email as `jo***@example.com`. */
export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  const head = user.slice(0, 2);
  return domain ? `${head}***@${domain}` : `${head}***`;
}

/** Mask a password to its length only, e.g. `•••••• (len 8)`. */
export function maskSecret(secret: string): string {
  return `${'•'.repeat(Math.min(secret.length, 8))} (len ${secret.length})`;
}
