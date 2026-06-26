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
import { visibleKendoField, selectKendoOption, kendoSelectedText } from './kendo.js';
import { humanClick } from './safeClick.js';
import { createLogger, type Logger } from './logger.js';
import { humanPause } from './human.js';

/** Field id suffixes to probe when finding the visible decoy set. */
const SUFFIXES = ['1', '2', '3', '4', '5', '6'];

export async function runVisaFormFlow(
  page: Page,
  config: LoginBotConfig,
  log: Logger = createLogger(),
): Promise<void> {
  const form = config.visaForm;
  if (!form.enabled) return;

  await page.waitForLoadState('networkidle').catch(() => {});
  await humanPause(900, 1800);
  log.step('Visa form: starting. Filling cascading dropdowns in order…');
  log.info(
    `Target values → Location: "${form.location}", Visa Type: "${form.visaType}", ` +
      `Sub Type: "${form.visaSubType}", Category: "${form.appointmentCategory}", ` +
      `For: "${form.appointmentFor}".`,
  );

  // 1. Location (drives Visa Type + Appointment Category).
  log.step('Visa form [1/5]: Location…');
  await pickDropdown(page, 'Location', form.location, log);

  // 2. Visa Type (drives Visa Sub Type).
  log.step('Visa form [2/5]: Visa Type…');
  await pickDropdown(page, 'VisaType', form.visaType, log);

  // 3. Visa Sub Type.
  log.step('Visa form [3/5]: Visa Sub Type…');
  await pickDropdown(page, 'VisaSubType', form.visaSubType, log);

  // 4. Appointment Category (its container is shown after Location is chosen).
  //    Non-fatal: some flows don't require it.
  log.step('Visa form [4/5]: Appointment Category…');
  await pickDropdown(page, 'AppointmentCategoryId', form.appointmentCategory, log, true);

  // Picking a "Premium" category opens a confirmation modal — log its message,
  // then reject it to keep the normal flow.
  await handlePremiumModal(page, log);

  // 5. Appointment For (radio: Individual / Family).
  log.step('Visa form [5/5]: Appointment For…');
  await pickAppointmentFor(page, form.appointmentFor, log);

  // 6. Submit.
  if (form.submit) {
    await humanPause(600, 1400);
    log.step('Visa form: all fields filled. Submitting (human mouse move + click)…');
    const urlBefore = page.url();
    await humanClick(page, page.locator(config.dashboard.submitButton).first());
    await page.waitForLoadState('networkidle').catch(() => {});
    await page
      .waitForFunction(
        // @ts-expect-error browser global at runtime
        (prev: string) => location.href !== prev,
        urlBefore,
        { timeout: 15_000 },
      )
      .catch(() => {});
    log.step(`Visa form submitted ✓. Landed on: ${page.url()}`);
    await logPageOutcome(page, log);
  } else {
    log.info('Visa form filled (submit disabled).');
  }
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
    const chosen = await kendoSelectedText(field.wrapper);
    log.info(`${baseId}: selected "${chosen}" (wanted "${value}").`);
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
  await radio.check({ force: true }).catch(async () => {
    await radio.click({ force: true });
  });
  log.info(`Appointment For: ${value}.`);
}

/**
 * If the Premium confirmation modal is showing, LOG its title + body message,
 * then click Reject to dismiss it and keep the normal (non-premium) flow.
 */
async function handlePremiumModal(page: Page, log: Logger): Promise<void> {
  const modal = page.locator('.modal.show').first();
  if (!(await modal.isVisible().catch(() => false))) return;

  const title = (await modal.locator('.modal-title').first().textContent().catch(() => '')) ?? '';
  const body = (await modal.locator('.modal-body').first().textContent().catch(() => '')) ?? '';
  log.warn(`Premium modal appeared — title: "${title.trim()}".`);
  log.warn(`Premium modal message: "${body.replace(/\s+/g, ' ').trim()}".`);

  const reject = modal.locator('.btn-danger', { hasText: /reject/i }).first();
  if (await reject.isVisible().catch(() => false)) {
    await reject.click({ force: true });
    log.info('Dismissed Premium modal (clicked Reject).');
    await humanPause(300, 700);
  }
}
