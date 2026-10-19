/**
 * WholeNumberInput
 *
 * A text box that only accepts a whole number (0 or more), for Wave Number and
 * Plant Age on the Capture Scan page. The value stays a string so the form can
 * tell an empty box from 0.
 *
 * A change that isn't all digits, typed or pasted, is rejected whole so the
 * previous value stays: pasting "14.5" must not become "145". A short hint tells
 * the operator why nothing changed.
 */

import { useEffect, useState } from 'react';

// How long the "Whole numbers only" hint stays after a rejected keystroke or paste.
const REJECTED_HINT_MS = 3000;
const DIGITS_ONLY = /^\d*$/;

interface WholeNumberInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function WholeNumberInput({
  id,
  value,
  onChange,
  disabled = false,
  placeholder,
  className,
}: WholeNumberInputProps) {
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    if (!rejected) return;
    const timer = setTimeout(() => setRejected(false), REJECTED_HINT_MS);
    return () => clearTimeout(timer);
  }, [rejected]);

  return (
    <>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(e) => {
          if (DIGITS_ONLY.test(e.target.value)) {
            setRejected(false);
            onChange(e.target.value);
          } else {
            setRejected(true);
          }
        }}
        disabled={disabled}
        className={className}
        placeholder={placeholder}
      />
      {rejected && (
        <p className="mt-1 text-xs text-gray-600">
          Whole numbers only (0 or more)
        </p>
      )}
    </>
  );
}
