/**
 * A small ⓘ next to the germination date on Capture Scan (#407, #428). Hovering or
 * clicking it opens a short note on how the plant age is computed from it.
 */

import { InfoTip } from './InfoTip';

export const GERMINATION_DATE_HELP =
  'Plant age = days since germination. The germination day is day 0, so a plant that germinated on 1 Oct is 9 days old on 10 Oct.';

export function GerminationDateInfo() {
  return (
    <InfoTip
      label="How is the plant age computed?"
      testId="germination-date-info"
    >
      {GERMINATION_DATE_HELP}
    </InfoTip>
  );
}
