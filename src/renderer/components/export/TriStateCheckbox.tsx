import { useEffect, useRef } from 'react';

/** A checkbox that shows a dash when only some of what it stands for is selected. */
export function TriStateCheckbox({
  allSelected,
  someSelected,
  onChange,
  label,
  disabled = false,
}: {
  allSelected: boolean;
  someSelected: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={allSelected}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 rounded border-gray-300"
      aria-label={label}
    />
  );
}
