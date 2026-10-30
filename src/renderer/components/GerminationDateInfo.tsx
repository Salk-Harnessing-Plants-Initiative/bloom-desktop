/**
 * A small ⓘ next to the germination date on Capture Scan (#407, #428). Hovering or
 * clicking it opens a short note on how the plant age is computed from it.
 */

import { InfoTip } from './InfoTip';

/** The tooltip's lines, shown one under another. */
export const GERMINATION_DATE_HELP = [
  'Plant age = days since germination',
  'Germination day is day 0.',
  'e.g. Germinated Oct 1 → 9 days old on Oct 10',
] as const;

export function GerminationDateInfo() {
  return (
    <InfoTip
      label="How is the plant age computed?"
      testId="germination-date-info"
    >
      {GERMINATION_DATE_HELP.map((line) => (
        <span key={line} className="block">
          {line}
        </span>
      ))}
    </InfoTip>
  );
}
