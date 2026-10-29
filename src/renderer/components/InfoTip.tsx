/**
 * A small ⓘ on Capture Scan: hovering or clicking it opens a short note.
 */

import { useState, type ReactNode } from 'react';

export interface InfoTipProps {
  /** What the ⓘ explains, for screen readers, e.g. "How is the plant age computed?" */
  label: string;
  children: ReactNode;
  testId: string;
}

export function InfoTip({ label, children, testId }: InfoTipProps) {
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
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-gray-400 text-[10px] font-semibold leading-none text-gray-500 hover:border-green-700 hover:text-green-700 before:content-['i']"
        data-testid={testId}
      />
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-5 z-20 block w-64 rounded-md border border-gray-300 bg-white p-2 text-xs font-normal leading-snug text-gray-700 shadow-lg"
          data-testid={`${testId}-text`}
        >
          {children}
        </span>
      )}
    </span>
  );
}
