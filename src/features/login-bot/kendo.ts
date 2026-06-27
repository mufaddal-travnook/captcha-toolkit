/**
 * Kendo UI dropdown helpers.
 *
 * The visa form uses Kendo dropdowns (`<span class="k-dropdown">` wrapping a
 * hidden `<input data-role="dropdownlist">`), not native <select>. To pick a
 * value we open the widget and click the option text in its popup listbox.
 *
 * The form also renders DECOY field sets (Location1, Location4, Location5…) with
 * obfuscated classes; only one set is visible. We always target the VISIBLE
 * widget for a given base id.
 */
import type { Page, Locator } from 'playwright';
import { humanPause } from './human.js';
import { humanClick } from './safeClick.js';

/**
 * Find the visible Kendo dropdown wrapper for a base field id (e.g. "Location").
 * Tries each candidate suffix and returns the first whose wrapper is visible.
 */
export async function visibleKendoField(
  page: Page,
  baseId: string,
  suffixes: string[],
): Promise<{ wrapper: Locator; inputId: string }> {
  for (const suffix of suffixes) {
    const inputId = `${baseId}${suffix}`;
    // The Kendo wrapper is the span.k-dropdown labelled by `${inputId}_label`.
    const wrapper = page.locator(`span.k-dropdown[aria-labelledby="${inputId}_label"]`);
    if (
      (await wrapper.count()) > 0 &&
      (await wrapper.first().isVisible().catch(() => false))
    ) {
      return { wrapper: wrapper.first(), inputId };
    }
  }
  throw new Error(`No visible Kendo dropdown found for "${baseId}" (suffixes: ${suffixes.join(',')}).`);
}

/**
 * Select an option (by visible text, case-insensitive contains) in a Kendo
 * dropdown: open the widget, wait for the popup list, click the matching item.
 */
export async function selectKendoOption(
  page: Page,
  wrapper: Locator,
  inputId: string,
  optionText: string,
): Promise<void> {
  await wrapper.scrollIntoViewIfNeeded().catch(() => {});
  await humanPause(250, 600);
  await humanClick(page, wrapper); // move cursor to the widget, then open the popup

  // The popup list is `#<inputId>_listbox` (referenced by aria-owns).
  const list = page.locator(`#${inputId}_listbox`);
  await list.waitFor({ state: 'visible', timeout: 8000 });

  // Prefer an EXACT (case-insensitive) match so "Dubai" doesn't hit
  // "Premium Lounge Dubai". Fall back to a contains match.
  const exact = list.locator('li', {
    hasText: new RegExp(`^\\s*${escapeRe(optionText)}\\s*$`, 'i'),
  });
  const contains = list.locator('li', { hasText: new RegExp(escapeRe(optionText), 'i') });
  const option = ((await exact.count()) > 0 ? exact : contains).first();
  await option.waitFor({ state: 'visible', timeout: 8000 });
  // A human reads the open list a beat before picking, then moves to the item.
  await humanPause(300, 750);
  await humanClick(page, option);

  // Let Kendo's change handler fire and populate dependent dropdowns.
  await humanPause(400, 900);
}

/** Read the current selected text of a Kendo dropdown wrapper. */
export async function kendoSelectedText(wrapper: Locator): Promise<string> {
  return (await wrapper.locator('.k-input').first().textContent())?.trim() ?? '';
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
