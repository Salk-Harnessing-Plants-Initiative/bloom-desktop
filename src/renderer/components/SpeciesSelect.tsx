/**
 * The Experiments page's species list. With Bloom on, species come from Bloom; the
 * last option opens Bloom's Species page to add one, and Refresh list fetches the list
 * again afterwards. With Bloom off, the list is kept on this computer: the last option
 * adds a species, and Remove from list takes the chosen one out.
 */

import { useEffect, useState, type ChangeEvent } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import type { UseSpeciesList } from '../hooks/useSpeciesList';
import { useBloomConnected } from '../hooks/useBloomConnected';

/** The option that opens Bloom instead of choosing a species. No species is named this. */
export const ADD_IN_BLOOM = '__add_species_in_bloom__';

/** The option that adds a species on this computer (Bloom off). No species is named this. */
export const ADD_LOCAL = '__add_species_here__';

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
  const bloomOn = useBloomConnected();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  // Chosen once the list shows it: a select can't take a value it has no option for.
  const [pendingChoice, setPendingChoice] = useState<string | null>(null);

  useEffect(() => {
    if (pendingChoice !== null && list.species.includes(pendingChoice)) {
      onChoose(pendingChoice);
      setPendingChoice(null);
    }
  }, [pendingChoice, list.species, onChoose]);

  const handleAdd = async () => {
    const name = newName.trim();
    const problem = await list.add(name);
    if (problem) {
      setEditError(problem);
      return;
    }
    setEditError(null);
    setAdding(false);
    setNewName('');
    setPendingChoice(name);
  };

  const handleRemove = async () => {
    const next = list.species.find((s) => s !== value) ?? null;
    const problem = await list.remove(value);
    if (problem) {
      setEditError(problem);
      return;
    }
    setEditError(null);
    setPendingChoice(next);
  };

  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === ADD_LOCAL) {
      // Not a species: keep the one chosen before, and ask for the name.
      onChoose(value);
      setAdding(true);
      setEditError(null);
      return;
    }
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
          {/* Green and bold, so it stands out from the species. */}
          {bloomOn ? (
            <option
              value={ADD_IN_BLOOM}
              className="font-semibold text-green-700"
            >
              Need a new species? Add it in Bloom…
            </option>
          ) : (
            <option value={ADD_LOCAL} className="font-semibold text-green-700">
              Add a species…
            </option>
          )}
        </select>
        {bloomOn ? (
          <button
            type="button"
            onClick={() => void list.refresh()}
            disabled={disabled || list.refreshing}
            className="text-xs text-lime-700 underline hover:no-underline disabled:opacity-50"
          >
            {list.refreshing ? 'Refreshing…' : 'Refresh list'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={disabled || !value || list.species.length < 2}
            className="text-xs text-lime-700 underline hover:no-underline disabled:opacity-50"
          >
            Remove from list
          </button>
        )}
      </div>
      {!bloomOn && adding && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            aria-label="New species name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className={FIELD_CLASS}
            placeholder="e.g. Lotus japonicus"
          />
          <button
            type="button"
            onClick={() => void handleAdd()}
            className="text-xs text-lime-700 underline hover:no-underline"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewName('');
              setEditError(null);
            }}
            className="text-xs text-gray-600 underline hover:no-underline"
          >
            Cancel
          </button>
        </div>
      )}
      {editError && <p className="mt-1 text-xs text-red-600">{editError}</p>}
      {list.message && (
        <p className="mt-1 text-xs text-gray-600" role="status">
          {list.message}
        </p>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
