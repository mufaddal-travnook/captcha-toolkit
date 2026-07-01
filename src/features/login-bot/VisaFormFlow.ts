/**
 * VisaFormFlow — fills the visa-type form that loads after the dashboard step.
 *
 * The form has CASCADING Kendo dropdowns (each selection populates the next):
 *   Location -> Visa Type -> Visa Sub Type -> Appointment Category
 * plus an "Appointment For" radio (Individual/Family), then Submit.
 *
 * Field ids are decoyed (Location1/Location4/Location5…); we always target the
 * VISIBLE widget for each base id. Values come from config.visaForm so they're
 * easy to change (e.g. Dubai vs Abu Dhabi).
 */
import type { Page } from 'playwright';
import type { LoginBotConfig } from './config.js';
import { visibleKendoField, selectKendoOption } from './kendo.js';
import { humanClick } from './safeClick.js';
import { createLogger, type Logger } from './logger.js';
import { humanPause, sleep } from './human.js';
import { ALL_COMBOS, SINGLE_COMBO, comboLabel, type VisaCombo, type ComboResult } from './visaCombos.js';
import { runDashboardCaptcha } from './DashboardFlow.js';
import { createNotifier, createSummaryNotifier, type Notifier } from '../notifier/index.js';
import { createShooter, type Shooter } from './screenshot.js';

const APPT_URL = 'https://uae.blsspainglobal.com/Global/bls/visatype';

/** Build the {{placeholder}} vars for a combo. */
function comboVars(combo: VisaCombo): Record<string, string> {
  return {
    location: combo.location,
    visaType: combo.visaType,
    visaSubType: combo.visaSubType,
    appointmentCategory: combo.appointmentCategory,
    appointmentFor: combo.appointmentFor,
    combo: comboLabel(combo),
    url: APPT_URL,
  };
}

/** Field id suffixes to probe when finding the visible decoy set. */
const SUFFIXES = ['1', '2', '3', '4', '5', '6'];

/** True if the current page is the anti-bot landing page. */
function isBotPage(page: Page): boolean {
  return /account\/bot/i.test(page.url());
}

/**
 * Orchestrator. Decides which combos to run (all 8 vs the single combo), then
 * fills + submits each. On landing at /account/bot, optionally goes back a page
 * and retries the same combo.
 */
export async function runVisaFormFlow(
  page: Page,
  config: LoginBotConfig,
  log: Logger = createLogger(),
  combosOverride?: VisaCombo[],
  shooter: Shooter = createShooter({ enabled: false }),
): Promise<ComboResult[]> {
  const form = config.visaForm;
  if (!form.enabled) return [];

  // Priority: explicit override (a batch's combos) → all 8 → single combo.
  const combos = combosOverride ?? (form.runAll ? ALL_COMBOS : [SINGLE_COMBO]);
  if (combos.length > 1) log.step(`Visa form: running ${combos.length} combinations.`);

  // Notifications (Telegram) — disabled automatically if not configured in .env.
  //  - notifier: MAIN bot → slot-available alerts only.
  //  - errNotifier: SUMMARY bot → errors + bot-blocks (kept off the slot channel).
  const notifier = createNotifier({ log: (m) => log.info(m) });
  const errNotifier = createSummaryNotifier({ log: (m) => log.info(m) });
  if (notifier.enabled) log.info('Notifier: Telegram enabled.');

  const results: ComboResult[] = [];

  for (let i = 0; i < combos.length; i++) {
    const combo = combos[i]!;
    log.step(`=== Combo ${i + 1}/${combos.length}: ${comboLabel(combo)} ===`);

    try {
      // Make sure we're actually ON the visa form before filling. After the
      // first combo's submit (or a bot-page recovery), we won't be — re-open it.
      if (!(await isVisaFormPage(page))) {
        const opened = await reopenVisaForm(page, config, log);
        if (!opened) {
          throw new Error('could not reach the visa form');
        }
      }

      let outcome = await fillAndSubmitCombo(page, config, combo, log, notifier, shooter);

      // If this combo landed us on the bot page, recover (back → captcha → form)
      // and re-submit the SAME combo, up to botRecoveryAttempts.
      let recov = 0;
      while (isBotPage(page) && recov < form.botRecoveryAttempts) {
        recov++;
        log.warn(`Landed on /account/bot. Recovery ${recov}/${form.botRecoveryAttempts}: going back…`);
        const opened = await reopenVisaForm(page, config, log);
        if (!opened) {
          log.warn('Recovery failed: could not re-open the visa form.');
          break;
        }
        outcome = await fillAndSubmitCombo(page, config, combo, log, notifier, shooter);
      }

      const blocked = isBotPage(page);
      if (blocked) await errNotifier.notify('bot-blocked', comboVars(combo));
      const note = blocked ? 'ended on /account/bot' : outcome.note;
      results.push({ combo: comboLabel(combo), ok: !blocked, note, slot: outcome.slot });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Combo ${i + 1}/${combos.length} (${comboLabel(combo)}) failed: ${msg}.`);
      await errNotifier.notify('error', { ...comboVars(combo), message: msg });
      results.push({ combo: comboLabel(combo), ok: false, note: msg });
      if (!form.continueOnComboFailure) {
        log.warn('Stopping (continueOnComboFailure=false).');
        break;
      }
      log.step('Continuing to the next combo despite the failure…');
    }

    // Breather between combinations (jittered), only in runAll mode.
    if (form.runAll && i < combos.length - 1) {
      const wait = Math.round(form.betweenCombosMs * (0.75 + Math.random() * 0.5));
      log.info(`Waiting ${(wait / 1000).toFixed(1)}s before the next combo…`);
      await sleep(wait);
    }
  }

  // Summary so you can see, per combination, what happened.
  if (results.length > 1) {
    log.step('───── RUN SUMMARY ─────');
    for (const r of results) log.info(`${r.ok ? '✓' : '✗'} ${r.combo} — ${r.note}`);
    log.step('───────────────────────');
  }
  return results;
}

/**
 * Get back to the visa form from wherever we are:
 *  - already on the form → done
 *  - on /account/bot or a post-submit page → go back; if that lands on the
 *    Verify Selection page, solve its captcha + submit to re-open the form.
 * Returns true if the visa form is showing afterwards.
 */
async function reopenVisaForm(page: Page, config: LoginBotConfig, log: Logger): Promise<boolean> {
  if (await isVisaFormPage(page)) return true;

  await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await humanPause(900, 1800);

  if (await isVisaFormPage(page)) return true;

  // Likely on the Verify Selection (dashboard captcha) page now.
  if (await isVerifyPage(page)) {
    log.step('Back on the Verify Selection page — re-solving captcha to re-open the form…');
    try {
      await runDashboardCaptcha(page, config, log);
    } catch (err) {
      log.warn(`Re-solving the dashboard captcha failed: ${err instanceof Error ? err.message : err}.`);
      return false;
    }
    return isVisaFormPage(page);
  }

  log.warn(`After going back, unexpected page: ${page.url()}`);
  return isVisaFormPage(page);
}

/** True if the current page is the dashboard "Verify Selection" captcha page. */
async function isVerifyPage(page: Page): Promise<boolean> {
  const btn = page.locator('#btnVerify');
  return (await btn.count()) > 0 && (await btn.first().isVisible().catch(() => false));
}

/** Fill all dropdowns/radio for one combo, then (optionally) submit. */
async function fillAndSubmitCombo(
  page: Page,
  config: LoginBotConfig,
  combo: VisaCombo,
  log: Logger,
  notifier: Notifier,
  shooter: Shooter = createShooter({ enabled: false }),
): Promise<{ slot: boolean; note: string }> {
  const form = config.visaForm;

  await page.waitForLoadState('networkidle').catch(() => {});
  // A person lands on the form and takes a moment to read it before touching
  // anything — a longer, more variable initial pause than between fields.
  await humanPause(1400, 3200);
  log.step('Filling visa form…');

  // 1. Location (drives Visa Type + Appointment Category).
  await pickDropdown(page, 'Location', combo.location, log);

  // Cascading dropdowns repopulate after each pick — wait for the network to
  // settle AND add a human "wait for the next field to appear" beat.
  await interFieldPause(page);

  // 2. Visa Type (drives Visa Sub Type).
  await pickDropdown(page, 'VisaType', combo.visaType, log);

  await interFieldPause(page);

  // 3. Visa Sub Type.
  await pickDropdown(page, 'VisaSubType', combo.visaSubType, log);

  await interFieldPause(page);

  // 4. Appointment Category (container shown after Location is chosen). Non-fatal.
  await pickDropdown(page, 'AppointmentCategoryId', combo.appointmentCategory, log, true);

  // Picking "Prime Time"/premium may open a confirmation modal — log + reject.
  await handlePremiumModal(page, combo, log);

  // 5. Appointment For (radio: Individual / Family).
  await pickAppointmentFor(page, combo.appointmentFor, log);

  await shooter.shot(page, `form-filled-${comboLabel(combo)}`);

  // 6. Submit.
  if (!form.submit) return { slot: false, note: 'filled (not submitted)' };

  await humanPause(600, 1400);
  const urlBefore = page.url();
  await humanClick(page, page.locator(config.dashboard.submitButton).first());
  await page.waitForLoadState('networkidle').catch(() => {});

  // Submit often returns a result MODAL (e.g. "No Appointments Available")
  // instead of navigating. Capture+log it before waiting for any URL change.
  const modal = await logResultModal(page, combo, log);
  await shooter.shot(page, `result-${comboLabel(combo)}`);

  const slot = isSlotAvailable(modal);
  if (slot) {
    log.step('🟢 Possible SLOT AVAILABLE — sending notification.');
    await notifier.notify('slot-available', {
      ...comboVars(combo),
      message: modal ? `${modal.title} — ${modal.message}` : 'Form submitted; no "no slots" message.',
    });
  }

  await page
    .waitForFunction(
      // @ts-expect-error browser global at runtime
      (prev: string) => location.href !== prev,
      urlBefore,
      { timeout: 15_000 },
    )
    .catch(() => {});
  await logPageOutcome(page, log);

  // Note for the summary. When the portal returns NO recognizable modal we can't
  // tell slot-vs-no-slot, so say so plainly rather than a bare "submitted".
  const note = slot ? 'SLOT AVAILABLE' : modal ? 'no slots' : 'submitted (no result modal)';
  return { slot, note };
}

/**
 * Pause between cascading dropdowns: wait for the network to settle (the next
 * dependent field is being populated server-side) plus a short, variable human
 * beat — the moment a person spends moving their eyes to the next field.
 */
async function interFieldPause(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => {});
  await humanPause(500, 1300);
}

/** True if the current page shows the visa form (a Location dropdown exists). */
async function isVisaFormPage(page: Page): Promise<boolean> {
  for (const s of SUFFIXES) {
    const w = page.locator(`span.k-dropdown[aria-labelledby="Location${s}_label"]`);
    if ((await w.count()) > 0 && (await w.first().isVisible().catch(() => false))) return true;
  }
  return false;
}

/**
 * After submit the site often shows a result MODAL instead of navigating —
 * e.g. "No Appointments Available". Wait briefly for it, LOG which COMBINATION
 * produced it plus its title + message (clear 3-line block), then dismiss it.
 */
async function logResultModal(
  page: Page,
  combo: VisaCombo,
  log: Logger,
): Promise<{ title: string; message: string } | null> {
  const modal = page.locator('.modal.show, [role="dialog"]:visible, .modal:visible').first();
  // Give the AJAX response a moment to render the modal; absence is fine.
  const appeared = await modal
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return null;

  const title = (await modal.locator('.modal-title, h1, h2, h3, h4').first().textContent().catch(() => '')) ?? '';
  const body = (await modal.locator('.modal-body, p').first().textContent().catch(() => '')) ?? '';
  const full = (await modal.innerText().catch(() => '')) ?? '';

  const t = title.replace(/\s+/g, ' ').trim();
  const msg = (body || full).replace(/\s+/g, ' ').trim();
  logModalBlock(log, comboLabel(combo), t, msg);

  // Dismiss it (Ok button, then any close control) so subsequent steps proceed.
  const ok = modal.locator('button, .btn', { hasText: /^\s*ok\s*$/i }).first();
  if (await ok.isVisible().catch(() => false)) {
    await humanPause(500, 1200);
    await humanClick(page, ok).catch(async () => ok.click({ force: true }));
  } else {
    const close = modal.locator('.close, [data-dismiss="modal"], button[aria-label="Close"]').first();
    await close.click({ force: true }).catch(() => {});
  }
  await humanPause(300, 700);
  return { title: t, message: msg };
}

/**
 * Decide whether a result modal means slots ARE available. We treat the known
 * "no slots" message as negative and anything else as a potential hit. This is
 * conservative on purpose: better to over-notify than miss a real slot.
 */
function isSlotAvailable(modal: { title: string; message: string } | null): boolean {
  if (!modal) return false; // no modal usually means it navigated onward, not a slot result
  const text = `${modal.title} ${modal.message}`.toLowerCase();
  const noSlot =
    /no\s+appointments?\s+available/.test(text) ||
    /no\s+slots?\s+(are\s+)?available/.test(text) ||
    /currently,?\s+no\s+slots/.test(text);
  return !noSlot;
}

/** Log a modal as a clear 3-line block: COMBINATION / TITLE / MESSAGE. */
function logModalBlock(log: Logger, combination: string, title: string, message: string): void {
  log.step('───── MODAL ─────');
  log.info(`COMBINATION : ${combination}`);
  log.info(`MODAL TITLE : ${title || '(none)'}`);
  log.info(`MODAL MESSAGE: ${message || '(none)'}`);
  log.step('─────────────────');
}

/** Log the result page's heading/alert so the final state is visible in logs. */
async function logPageOutcome(page: Page, log: Logger): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => {});
  const heading = await page
    .locator('h1, h2, h3, h4, .alert, .text-danger, .validation-summary')
    .filter({ hasText: /\S/ })
    .first()
    .textContent()
    .catch(() => null);
  const title = await page.title().catch(() => '');
  if (title) log.info(`Page title: "${title.trim()}".`);
  if (heading) log.info(`Page message: "${heading.replace(/\s+/g, ' ').trim().slice(0, 200)}".`);
}

/** Select a value in a cascading Kendo dropdown by base id. */
async function pickDropdown(
  page: Page,
  baseId: string,
  value: string,
  log: Logger,
  optional = false,
): Promise<void> {
  try {
    const field = await visibleKendoField(page, baseId, SUFFIXES);
    await selectKendoOption(page, field.wrapper, field.inputId, value);
  } catch (err) {
    if (optional) {
      log.warn(`${baseId}: could not select; skipping. (${(err as Error).message})`);
      return;
    }
    throw err;
  }
}

/** Choose the Appointment For radio (Individual/Family) on the visible set. */
async function pickAppointmentFor(page: Page, value: string, log: Logger): Promise<void> {
  // Radios are name="AppointmentFor<suffix>" value="Individual|Family".
  const radio = page
    .locator(`input[type="radio"][name^="AppointmentFor"][value="${value}"]:visible`)
    .first();
  if ((await radio.count()) === 0) {
    log.warn(`Appointment For "${value}" radio not found; leaving default.`);
    return;
  }
  // Click the radio the human way (cursor moves to it) rather than a forced
  // programmatic check. Kendo styled radios are often tiny, so fall back to the
  // associated label, then to a forced check only as a last resort.
  await humanPause(200, 500);
  try {
    await humanClick(page, radio);
  } catch {
    const label = page.locator(`label[for="${await radio.getAttribute('id')}"]:visible`).first();
    if ((await label.count()) > 0) {
      await humanClick(page, label).catch(async () => radio.check({ force: true }));
    } else {
      await radio.check({ force: true }).catch(async () => radio.click({ force: true }));
    }
  }
}

/**
 * If the Premium confirmation modal is showing, LOG which COMBINATION triggered
 * it plus its title + message (clear block), then click Reject to dismiss it and
 * keep the normal (non-premium) flow.
 */
async function handlePremiumModal(page: Page, combo: VisaCombo, log: Logger): Promise<void> {
  const modal = page.locator('.modal.show').first();
  if (!(await modal.isVisible().catch(() => false))) return;

  const title = (await modal.locator('.modal-title').first().textContent().catch(() => '')) ?? '';
  const body = (await modal.locator('.modal-body').first().textContent().catch(() => '')) ?? '';
  logModalBlock(log, comboLabel(combo), title.trim(), body.replace(/\s+/g, ' ').trim());

  const reject = modal.locator('.btn-danger', { hasText: /reject/i }).first();
  if (await reject.isVisible().catch(() => false)) {
    // A person reads the modal before reacting, then moves to the button.
    await humanPause(700, 1500);
    await humanClick(page, reject).catch(async () => reject.click({ force: true }));
    await humanPause(300, 700);
  }
}
