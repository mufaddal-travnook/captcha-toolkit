/**
 * Text normalization shared by solvers.
 *
 * OCR/vision output is noisy ("4 4 7", "447\n", "44?"). Normalize before
 * comparing to the target so both solvers match consistently.
 */

/** Keep digits only. "4 4 7\n" -> "447". */
export function digitsOnly(raw: string): string {
  return raw.replace(/\D+/g, '');
}

/** Compare a read cell value to the target number after normalization. */
export function isMatch(cellValue: string, target: string): boolean {
  const a = digitsOnly(cellValue);
  const b = digitsOnly(target);
  return a.length > 0 && a === b;
}
