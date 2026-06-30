/**
 * Visa-form combinations — kept in a separate file so they're easy to edit
 * without touching the rest of the config.
 *
 * `runAll: true`  -> the bot fills + submits EVERY combo in `ALL_COMBOS`.
 * `runAll: false` -> the bot uses only `SINGLE_COMBO`.
 */

/** One set of dropdown choices for the visa form. */
export interface VisaCombo {
  location: string; // "Dubai" | "Abu Dhabi"
  visaType: string; // matched case-insensitive "contains" (e.g. "Schengen")
  visaSubType: string; // "Tourist" | "Business"
  appointmentCategory: string; // "Prime Time" | "Normal"
  appointmentFor: 'Individual' | 'Family';
}

/** Outcome of processing one combo (for run summaries). */
export interface ComboResult {
  combo: string; // human label
  ok: boolean; // submitted without ending on /account/bot or erroring
  note: string; // "submitted" | "no slots" | "ended on /account/bot" | error text
  slot?: boolean; // a slot looked available
}

/** The single combo used when runAll = false. Edit freely. */
export const SINGLE_COMBO: VisaCombo = {
  location: 'Abu Dhabi',
  visaType: 'Schengen',
  visaSubType: 'Business',
  appointmentCategory: 'Normal',
  appointmentFor: 'Individual',
};

/** Dimensions that vary across the 8 combinations. */
const LOCATIONS = ['Dubai', 'Abu Dhabi'] as const;
const SUB_TYPES = ['Tourist', 'Business'] as const;
const CATEGORIES = ['Prime Time', 'Normal'] as const;

/**
 * All 8 combinations (2 locations × 2 sub-types × 2 categories), in order:
 *   dubai-schengen-tourist-prime time
 *   dubai-schengen-tourist-normal
 *   dubai-schengen-business-prime time
 *   dubai-schengen-business-normal
 *   ...then the same four for abu dhabi.
 * Visa Type and Appointment For are fixed (only one option each in scope).
 */
export const ALL_COMBOS: VisaCombo[] = LOCATIONS.flatMap((location) =>
  SUB_TYPES.flatMap((visaSubType) =>
    CATEGORIES.map((appointmentCategory) => ({
      location,
      visaType: 'Schengen',
      visaSubType,
      appointmentCategory,
      appointmentFor: 'Individual' as const,
    })),
  ),
);

/** Human-readable label for logs, e.g. "Dubai · Schengen · Tourist · Prime Time". */
export function comboLabel(c: VisaCombo): string {
  return `${c.location} · ${c.visaType} · ${c.visaSubType} · ${c.appointmentCategory}`;
}
