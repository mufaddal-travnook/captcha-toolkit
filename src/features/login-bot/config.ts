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
  /** Which captcha solver to use. */
  solver: SolverName;
  /** Retry/backoff for transient failures and captcha misses. */
  retries: number;
  backoffMs: number;
  /** Per-action timeout (ms). */
  timeoutMs: number;
  selectors: Selectors;
  /** Post-login dashboard step (second captcha). */
  dashboard: DashboardConfig;
  /** Visa-type form filled after the dashboard step. */
  visaForm: VisaFormConfig;
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
    captchaMainDiv: '#captcha-main-div',
    tileImage: 'img.captcha-img',
    verifiedMessage: '#captcha-message-div',
    // Action controls are <div class="img-action-div" onclick="onReload()/onSubmit()">.
    reloadButton: '.img-action-div:has-text("Reload")',
    submitSelection: '.img-action-div:has-text("Submit")',
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
  },
};
