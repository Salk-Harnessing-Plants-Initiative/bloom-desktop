/**
 * A small ⓘ next to "Start date" on Capture Scan (#407): hovering it says what
 * the start date is. Any day the experiment counts plant age from can be used.
 */

export const START_DATE_HELP =
  'Any day you count plant age from (day 0): sowing, transfer to the cylinder, or your own start.';

export function StartDateInfo() {
  return (
    <span
      role="img"
      tabIndex={0}
      title={START_DATE_HELP}
      aria-label={START_DATE_HELP}
      // The "i" is drawn by CSS so it stays out of the line's text.
      className="ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-gray-400 align-middle text-[10px] font-semibold leading-none text-gray-500 before:content-['i']"
      data-testid="start-date-info"
    />
  );
}
