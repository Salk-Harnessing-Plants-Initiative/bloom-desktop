/**
 * The Experiments page's species list. Species come from Bloom; the last option opens
 * Bloom's Species page to add one, and Refresh list fetches the list again afterwards.
 */

import type { ChangeEvent } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import type { UseSpeciesList } from '../hooks/useSpeciesList';

/** The option that opens Bloom instead of choosing a species. No species is named this. */
export const ADD_IN_BLOOM = '__add_species_in_bloom__';

export interface SpeciesSelectProps {
  registration: UseFormRegisterReturn<'species'>;
  /** The chosen species, to restore after the Bloom option is picked. */
  value: string;
  /** Sets the form's species. */
  onChoose: (species: string) => void;
  list: UseSpeciesList;
  disabled?: boolean;
  error?: string;
}

const FIELD_CLASS =
  'p-2 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none w-[200px] border border-gray-300';

export function SpeciesSelect({
  registration,
  value,
  onChoose,
  list,
  disabled = false,
  error,
}: SpeciesSelectProps) {
  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === ADD_IN_BLOOM) {
      // Not a species: keep the one chosen before, and open Bloom.
      onChoose(value);
      void list.openAddPage();
      return;
    }
    void registration.onChange(e);
  };

  return (
    <div className="mb-4">
      <label htmlFor="species-select" className="block text-xs font-bold mb-1">
        Species
      </label>
      <div className="flex items-center gap-2">
        <select
          id="species-select"
          {...registration}
          onChange={handleChange}
          className={FIELD_CLASS}
          disabled={disabled || list.loading}
        >
          {list.species.map((species) => (
            <option key={species} value={species}>
              {species}
            </option>
          ))}
          <option value={ADD_IN_BLOOM}>
            Need a new species? Add it in Bloom…
          </option>
        </select>
        <button
          type="button"
          onClick={() => void list.refresh()}
          disabled={disabled || list.refreshing}
          className="text-xs text-lime-700 underline hover:no-underline disabled:opacity-50"
        >
          {list.refreshing ? 'Refreshing…' : 'Refresh list'}
        </button>
      </div>
      {list.source === 'built-in' && !list.message && (
        <p
          className="mt-1 text-xs text-gray-500"
          data-testid="species-built-in"
        >
          Couldn&apos;t get the list from Bloom yet, so the built-in list is
          shown.
        </p>
      )}
      {list.message && (
        <p className="mt-1 text-xs text-gray-600" role="status">
          {list.message}
        </p>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
