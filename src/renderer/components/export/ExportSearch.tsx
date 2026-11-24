/**
 * Export Scans' search (#471), on one line: a box matching the experiment name, the
 * phenotyper, the plant barcode, or a date typed the way the page shows it ("Nov 20,
 * 2026"), and a From/To range of capture days. Both must match when both are set.
 */

import type { ScanFilter } from '../../../types/scan-groups';
import { SearchIcon } from '../../../components/SearchIcon';

export interface ExportSearchValues {
  search: string;
  /** Local "YYYY-MM-DD", or '' for none. */
  dateFrom: string;
  dateTo: string;
}

export const NO_SEARCH: ExportSearchValues = {
  search: '',
  dateFrom: '',
  dateTo: '',
};

/** A date input's value once whole: '' while its year is still being typed ("0002-…"). */
const wholeDate = (value: string) =>
  /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) ? value : '';

/** The filter the search line asks for: the search trimmed, dates once whole. */
export function searchFilter(values: ExportSearchValues): ScanFilter {
  const search = values.search.trim();
  const dateFrom = wholeDate(values.dateFrom);
  const dateTo = wholeDate(values.dateTo);
  return {
    ...(search ? { search } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  };
}

const isSet = (values: ExportSearchValues) =>
  values.search.trim() !== '' || values.dateFrom !== '' || values.dateTo !== '';

export function ExportSearch({
  values,
  onChange,
  disabled,
}: {
  values: ExportSearchValues;
  onChange: (values: ExportSearchValues) => void;
  disabled: boolean;
}) {
  const set = (part: Partial<ExportSearchValues>) =>
    onChange({ ...values, ...part });

  return (
    <fieldset
      disabled={disabled}
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-white p-4 shadow-sm"
    >
      <legend className="sr-only">Search scans</legend>
      <div className="relative w-full max-w-md">
        <SearchIcon />
        <input
          type="search"
          value={values.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Experiment, phenotyper, barcode or date"
          aria-label="Search scans"
          className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        From
        <input
          type="date"
          value={values.dateFrom}
          max={values.dateTo || undefined}
          onChange={(e) => set({ dateFrom: e.target.value })}
          aria-label="From date"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        To
        <input
          type="date"
          value={values.dateTo}
          min={values.dateFrom || undefined}
          onChange={(e) => set({ dateTo: e.target.value })}
          aria-label="To date"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
      </label>
      {isSet(values) && (
        <button
          type="button"
          onClick={() => onChange(NO_SEARCH)}
          className="ml-auto rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
        >
          Clear
        </button>
      )}
    </fieldset>
  );
}
