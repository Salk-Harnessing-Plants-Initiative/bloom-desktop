import type { ReactNode } from 'react';

interface HoverLabelProps {
  /** Shown above the button on hover or keyboard focus, e.g. "Upload to Bloom". */
  label: string;
  children: ReactNode;
}

/**
 * A short label that appears straight away above an icon button on hover or focus.
 * The browser's own `title` tooltip waits about a second, so icons like Upload went
 * unrecognised. The button itself keeps an `aria-label` for screen readers.
 */
export function HoverLabel({ label, children }: HoverLabelProps) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        aria-hidden="true"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs font-medium text-white opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
