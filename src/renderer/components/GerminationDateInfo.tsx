/**
 * A small ⓘ next to the germination date on Capture Scan (#407, #428). Hovering or
 * clicking it opens a short note on how the plant age is computed from it.
 */

import { useState } from 'react';

export const GERMINATION_DATE_HELP =
  'Plant age = days since germination. The germination day is day 0, so a plant that germinated on 1 Oct is 9 days old on 10 Oct.';

export function GerminationDateInfo() {
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
        data-testid="germination-date-info"
      />
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-5 z-20 block w-64 rounded-md border border-gray-300 bg-white p-2 text-xs font-normal leading-snug text-gray-700 shadow-lg"
          data-testid="germination-date-info-text"
        >
          {GERMINATION_DATE_HELP}
        </span>
      )}
    </span>
  );
}
