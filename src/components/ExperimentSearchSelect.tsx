/**
 * An experiment picker that can be searched by typing (#471): an input showing the
 * chosen experiment, which narrows the list to names containing what is typed. Pick
 * with the mouse, or with the arrow keys and Enter; Escape closes it unchanged.
 */

import { useId, useState } from 'react';
import { SearchIcon } from './SearchIcon';

export interface ExperimentOption {
  id: string;
  label: string;
}

export interface ExperimentSearchSelectProps {
  id?: string;
  experiments: ExperimentOption[];
  /** The chosen experiment's id; '' for none. */
  value: string;
  onChange: (id: string) => void;
  /** The entry for no experiment, e.g. "All Experiments". */
  noneLabel: string;
  className?: string;
}

export function ExperimentSearchSelect({
  id,
  experiments,
  value,
  onChange,
  noneLabel,
  className = '',
}: ExperimentSearchSelectProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const chosen = experiments.find((e) => e.id === value);
  const wanted = query.trim().toLowerCase();
  const options: ExperimentOption[] = [
    { id: '', label: noneLabel },
    ...experiments.filter((e) => e.label.toLowerCase().includes(wanted)),
  ];

  const openList = () => {
    setOpen(true);
    setActive(0);
  };
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const pick = (option: ExperimentOption) => {
    onChange(option.id);
    close();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return openList();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => Math.min(options.length - 1, Math.max(0, i + step)));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (options[active]) pick(options[active]);
    } else if (event.key === 'Escape') {
      close();
    }
  };

  return (
    <div className={`relative ${className}`}>
      <SearchIcon />
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        // Shows the choice until the list is opened, then what is typed.
        value={open ? query : (chosen?.label ?? noneLabel)}
        placeholder="Type to search experiments…"
        onFocus={openList}
        // Still focused after a pick: a click opens the list again.
        onClick={() => {
          if (!open) openList();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(e.target.value.trim() ? 1 : 0);
        }}
        onKeyDown={onKeyDown}
        onBlur={close}
        className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-lime-500"
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg"
        >
          {options.map((option, i) => (
            <li
              key={option.id || 'none'}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={option.id === value}
              // Before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(option);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${
                i === active ? 'bg-lime-50' : ''
              } ${option.id === value ? 'font-medium' : ''}`}
            >
              {option.label}
            </li>
          ))}
          {options.length === 1 && (
            <li className="px-3 py-2 text-sm text-gray-500" aria-disabled>
              No experiments match &ldquo;{query.trim()}&rdquo;
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
