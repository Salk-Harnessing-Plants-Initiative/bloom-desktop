/**
 * Capture Scan's optional "Germination Colour" (#429): the lab's colour for the plant,
 * saved to the plant when its scan is saved and uploaded to Bloom's germ_day_color
 * ("none" when empty). It starts from the entered plant's own saved colour, never
 * another plant's, and is cleaned to camel case when the field is left.
 */

import { useEffect, useState, type ReactNode } from 'react';
import {
  MAX_GERM_DAY_COLOR_LENGTH,
  normalizeGermDayColor,
} from '../../utils/germ-day-color';
import { InfoTip } from '../components/InfoTip';

export interface GermDayColorField {
  /** The colour to send with the scan, cleaned ('' for none). */
  germDayColor: string;
  field: ReactNode;
}

export function useGermDayColorField(
  /** Which plant is entered: the colour starts afresh for each. */
  plantKey: string,
  /** The entered plant's saved colour, if it has one. */
  savedColor: string | null,
  /** Shown only once a plant is entered. */
  show: boolean,
  disabled: boolean
): GermDayColorField {
  const [text, setText] = useState(savedColor ?? '');
  useEffect(() => {
    setText(savedColor ?? '');
  }, [plantKey, savedColor]);

  const field = show ? (
    <div className="mt-4" data-testid="germ-day-color">
      <label
        htmlFor="germDayColor"
        className="block text-sm font-medium text-gray-700 mb-1"
      >
        Germination Colour{' '}
        <span className="font-normal text-gray-500">(optional)</span>
        <InfoTip
          label="What goes in the germination colour?"
          testId="germ-day-color-info"
        >
          You can add the plant&apos;s germination colour, for example Red or
          GermRed.
        </InfoTip>
      </label>
      <input
        id="germDayColor"
        type="text"
        value={text}
        maxLength={MAX_GERM_DAY_COLOR_LENGTH}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => setText(normalizeGermDayColor(text))}
        disabled={disabled}
        // What Bloom gets when it's left empty.
        placeholder="none"
        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
      />
    </div>
  ) : null;

  return { germDayColor: normalizeGermDayColor(text), field };
}
