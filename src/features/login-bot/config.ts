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
  /** Keep the browser open after the run instead of closing it. */
  keepOpen: boolean;
  /** Save debug screenshots at major steps (to ./screenshots/<run>/). */
  screenshots: boolean;
  /** Capture full-page screenshots (vs viewport) when screenshots are on. */
  screenshotsFullPage: boolean;
  /** Which captcha solver to use. */
  solver: SolverName;
  /** Retry/backoff for transient failures and captcha misses. */
  retries: number;
  backoffMs: number;
  /** Per-action timeout (ms). */
  timeoutMs: number;
  /**
   * Optional proxy for ALL browser traffic — e.g. route an EC2 box out through
   * your home IP via an SSH SOCKS tunnel: "socks5://localhost:1080".
   * Empty string = no proxy (direct). Can also be set via PROXY_URL in .env.
   */
  proxyServer: string;
  selectors: Selectors;
  /** Captcha solve retry tuning. */
  captcha: CaptchaConfig;
  /** Post-login dashboard step (second captcha). */
  dashboard: DashboardConfig;
  /** Visa-type form filled after the dashboard step. */
  visaForm: VisaFormConfig;
}

export interface CaptchaConfig {
  /** How many extra attempts after the first (total tries = retries + 1). */
  retries: number;
  /** Base backoff between retries (ms); jittered ±25% and grows exponentially. */
  backoffMs: number;
  /** How long to wait for the "Verified!" message before declaring a miss (ms). */
  verifyTimeoutMs: number;
}

export interface VisaFormConfig {
  /** Fill the visa form after the dashboard step. */
  enabled: boolean;
  /** Submit the form after filling it. */
  submit: boolean;
  /**
   * If true, fill+submit ALL 8 combinations (see visaCombos.ALL_COMBOS).
   * If false, use the single combo from visaCombos.SINGLE_COMBO.
   */
  runAll: boolean;
  /**
   * On landing at /account/bot, go back one page, re-fill and re-submit, up to
   * this many times before giving up on a combo. 0 = no recovery.
   */
  botRecoveryAttempts: number;
  /**
   * In runAll mode, wait this long (ms) between combinations — gives the site a
   * breather and looks less robotic. Jittered ±25%.
   */
  betweenCombosMs: number;
  /**
   * In runAll mode, if one combo fails (can't reach the form / errors), keep
   * going with the next combo instead of aborting the whole run.
   */
  continueOnComboFailure: boolean;
  /** Batched mode: combos per fresh-session batch. */
  batchSize: number;
  /** Batched mode: gap between batches (ms), jittered ±25%. */
  betweenRunsMs: number;
}

export interface DashboardConfig {
  /** Run the dashboard step after login. */
  enabled: boolean;
  /** "Verify Selection" button that opens the dashboard captcha. */
  verifyButton: string;
  /** "Submit" button revealed after the captcha verifies. */
  submitButton: string;
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
  captchaMainDiv: string; // container with prompt + grid (screenshot target)
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
  keepOpen: true,
  screenshots: true, // always capture step screenshots (server debugging)
  screenshotsFullPage: false,
  solver: 'openai',
  retries: 3,
  backoffMs: 1500,
  timeoutMs: 30_000,
  proxyServer: process.env.PROXY_URL ?? '', // e.g. socks5://localhost:1080
  selectors: {
    emailCandidates: idRange('UserId', 10),
    passwordCandidates: idRange('Password', 10),
    verifyButton: '#btnVerify',
    verifiedIndicator: '#btnVerified',
    submitButton: '#btnSubmit',
    captchaFrame: 'iframe.k-content-frame',
    captchaMainDiv: '#captcha-main-div',
    tileImage: 'img.captcha-img',
    verifiedMessage: '#captcha-message-div',
    // Action controls are <div class="img-action-div" onclick="onReload()/onSubmit()">.
    reloadButton: '.img-action-div:has-text("Reload")',
    submitSelection: '.img-action-div:has-text("Submit")',
  },
  captcha: {
    retries: 4, // 5 total tries — captcha misreads are common, retries are cheap-ish
    backoffMs: 1200,
    verifyTimeoutMs: 8000,
  },
  dashboard: {
    enabled: true,
    // Dashboard reuses the same ids as login: #btnVerify ("Verify Selection")
    // opens the captcha; #btnSubmit ("Submit") is revealed after it verifies.
    verifyButton: '#btnVerify',
    submitButton: '#btnSubmit',
  },
  visaForm: {
    enabled: true,
    submit: true,
    // false → single combo (visaCombos.SINGLE_COMBO); true → all 8 combos.
    runAll: false,
    botRecoveryAttempts: 1,
    betweenCombosMs: 6000, // breather between combos in runAll mode
    continueOnComboFailure: true,
    batchSize: 2, // batched mode: 2 combos per fresh session → 4 batches for 8 combos
    betweenRunsMs: 45_000, // ~45s gap between batches (jittered)
  },
};
