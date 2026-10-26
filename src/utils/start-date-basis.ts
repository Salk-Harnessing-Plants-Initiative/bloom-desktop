/**
 * What a wave's start date is: the day the seedlings were transferred to the
 * cylinder, the sowing date, the germination date, or something else the phenotyper
 * describes. Recorded with the date (#428), so two waves that both say "day 9" can
 * be told apart. Shared by the main process (which enforces it when saving) and
 * Capture Scan (which asks for it).
 */

export const START_DATE_BASES = [
  'transfer',
  'sowing',
  'germination',
  'other',
] as const;

export type StartDateBasis = (typeof START_DATE_BASES)[number];

/** Longest description of an "Other" start date. */
export const MAX_BASIS_OTHER_LENGTH = 100;

/** The choices, in the order Capture Scan shows them. */
export const START_DATE_BASIS_CHOICES: {
  value: StartDateBasis;
  label: string;
  hint?: string;
}[] = [
  {
    value: 'transfer',
    label: 'Transfer to cylinder',
    hint: 'the day the seedlings went into the cylinder',
  },
  { value: 'sowing', label: 'Sowing', hint: 'the day the seeds were sown' },
  {
    value: 'germination',
    label: 'Germination',
    hint: 'the day the seeds germinated',
  },
  { value: 'other', label: 'Other' },
];

export function isStartDateBasis(value: unknown): value is StartDateBasis {
  return (START_DATE_BASES as readonly unknown[]).includes(value);
}

/** What's wrong with the chosen basis, or null when it can be saved. */
export function startDateBasisError(
  basis: unknown,
  other: unknown
): string | null {
  if (!isStartDateBasis(basis)) return 'Choose what the start date is.';
  if (basis !== 'other') return null;
  const text = typeof other === 'string' ? other.trim() : '';
  if (!text) return 'Say what the start date is.';
  if (text.length > MAX_BASIS_OTHER_LENGTH) {
    return `Keep it to ${MAX_BASIS_OTHER_LENGTH} characters.`;
  }
  return null;
}

/** "transfer to cylinder", "other: day 2 after germination", or null when not recorded. */
export function describeStartDateBasis(
  basis: string | null,
  other: string | null
): string | null {
  if (basis === 'other') return other ? `other: ${other}` : 'other';
  const choice = START_DATE_BASIS_CHOICES.find((c) => c.value === basis);
  return choice ? choice.label.toLowerCase() : null;
}
