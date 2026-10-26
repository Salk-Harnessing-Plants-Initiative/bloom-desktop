/**
 * A small ⓘ next to the start date on Capture Scan (#407). Hovering or clicking it
 * opens a short note on how the plant age is computed from it (the choice under the
 * date says which day it is).
 */

import { useState } from 'react';

export const START_DATE_HELP =
  'Plant age = days since this date. This date is day 0, so 12 Oct → 9 days old on 21 Oct.';

export function StartDateInfo() {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative ml-1 inline-block align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/* The "i" is drawn by CSS so it stays out of the line's text. */}
      <button
        type="button"
        aria-label="How is the plant age computed?"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-gray-400 text-[10px] font-semibold leading-none text-gray-500 hover:border-green-700 hover:text-green-700 before:content-['i']"
        data-testid="start-date-info"
      />
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-5 z-20 block w-64 rounded-md border border-gray-300 bg-white p-2 text-xs font-normal leading-snug text-gray-700 shadow-lg"
          data-testid="start-date-info-text"
        >
          {START_DATE_HELP}
        </span>
      )}
    </span>
  );
}
