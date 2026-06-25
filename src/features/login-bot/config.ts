/**
 * Login-bot configuration — everything tunable lives here (no secrets).
 * Credentials come from .env; this file holds URL, selectors, and behavior.
 */
import type { SolverName } from '../../core/types.js';

export interface LoginBotConfig {
  /** Login page URL. */
  url: string;
  /** Run with a visible browser window. */
  headed: boolean;
  /** Which captcha solver to use. */
  solver: SolverName;
  /** Retry/backoff for transient failures and captcha misses. */
  retries: number;
  backoffMs: number;
  /** Per-action timeout (ms). */
  timeoutMs: number;
  selectors: Selectors;
}

export interface Selectors {
  /** Candidate ids for the real (visible) email/password among the decoys. */
  emailCandidates: string[];
  passwordCandidates: string[];
  /** Buttons on the main page. */
  verifyButton: string;
  verifiedIndicator: string;
  submitButton: string;
  /** Captcha iframe and its inner elements. */
  captchaFrame: string;
  promptLabel: string; // many decoys; we pick the VISIBLE one
  gridContainer: string; // screenshot target
  tileImage: string; // discrete tiles, clicked by index
  verifiedMessage: string; // success signal inside the frame
  reloadButton: string; // by visible text fallback handled in code
  submitSelection: string; // by visible text fallback handled in code
}

/** Build candidate id selectors like #UserId1 .. #UserId10. */
function idRange(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `#${prefix}${i + 1}`);
}

export const DEFAULT_CONFIG: LoginBotConfig = {
  url: 'https://uae.blsspainglobal.com/Global/Account/LogIn?ReturnUrl=%2FGlobal%2Fbls%2FVisaTypeVerification',
  headed: true,
  solver: 'openai',
  retries: 3,
  backoffMs: 1500,
  timeoutMs: 30_000,
  selectors: {
    emailCandidates: idRange('UserId', 10),
    passwordCandidates: idRange('Password', 10),
    verifyButton: '#btnVerify',
    verifiedIndicator: '#btnVerified',
    submitButton: '#btnSubmit',
    captchaFrame: 'iframe.k-content-frame',
    promptLabel: '.box-label',
    gridContainer: '.row.no-gutters',
    tileImage: 'img.captcha-img',
    verifiedMessage: '#captcha-message-div',
    reloadButton: 'text=/reload/i',
    submitSelection: 'text=/submit/i',
  },
};
