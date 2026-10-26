/**
 * "This date is the:" choice under the start date on Capture Scan (#428). Nothing
 * is chosen until the phenotyper picks one; "Other" asks what it is.
 */

import { useId } from 'react';
import {
  MAX_BASIS_OTHER_LENGTH,
  START_DATE_BASIS_CHOICES,
  type StartDateBasis,
} from '../../utils/start-date-basis';

export interface StartDateBasisFieldProps {
  basis: StartDateBasis | '';
  other: string;
  onChange: (basis: StartDateBasis, other: string) => void;
  disabled?: boolean;
}

export function StartDateBasisField({
  basis,
  other,
  onChange,
  disabled = false,
}: StartDateBasisFieldProps) {
  const name = useId();
  return (
    <fieldset className="text-sm text-gray-700" data-testid="start-date-basis">
      <legend className="font-medium">This date is the:</legend>
      {START_DATE_BASIS_CHOICES.map((choice) => (
        <label key={choice.value} className="flex items-start gap-2">
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={basis === choice.value}
            onChange={() => onChange(choice.value, other)}
            disabled={disabled}
            className="mt-1"
            data-testid={`start-date-basis-${choice.value}`}
          />
          <span>
            <span className="font-bold text-green-800">{choice.label}</span>
            {choice.hint && (
              <span className="text-gray-500">: {choice.hint}</span>
            )}
          </span>
        </label>
      ))}
      {basis === 'other' && (
        <input
          type="text"
          aria-label="What the start date is"
          placeholder="What is this date?"
          value={other}
          maxLength={MAX_BASIS_OTHER_LENGTH}
          onChange={(e) => onChange('other', e.target.value)}
          disabled={disabled}
          className="mt-1 w-full px-3 py-1.5 border border-gray-300 rounded-md"
          data-testid="start-date-basis-other-text"
        />
      )}
    </fieldset>
  );
}
