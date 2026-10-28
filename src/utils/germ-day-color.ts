/**
 * The germination colour typed on Capture Scan (#429), cleaned to one style before it's
 * saved and uploaded to Bloom's cyl_plants.germ_day_color: words joined in camel case
 * ("arctic blue" → "ArcticBlue", "GERM RED" → "GermRed"), capitals inside a word kept
 * ("GermRed"), letters and digits only. "None"-style entries (na, N/A, none) count as
 * empty, which is sent as "none".
 */

export const MAX_GERM_DAY_COLOR_LENGTH = 40;

/** Typed for "no colour"; compared with spaces and punctuation removed, ignoring case. */
const NONE_ENTRIES = new Set(['na', 'none']);

function camelWord(word: string): string {
  // A word typed all in one case is capitalised; one with capitals inside is kept.
  const mixedCase = word !== word.toLowerCase() && word !== word.toUpperCase();
  const rest = mixedCase ? word.slice(1) : word.slice(1).toLowerCase();
  return word[0].toUpperCase() + rest;
}

/** The colour as saved: camel case, or '' for none. */
export function normalizeGermDayColor(text: unknown): string {
  if (typeof text !== 'string') return '';
  const words = text.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0 || NONE_ENTRIES.has(words.join('').toLowerCase())) {
    return '';
  }
  return words.map(camelWord).join('').slice(0, MAX_GERM_DAY_COLOR_LENGTH);
}
