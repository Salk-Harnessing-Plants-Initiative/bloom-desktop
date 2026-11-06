/**
 * Export Scans' list (#436): experiments, collapsed, with a search; an opened
 * experiment shows its days, an opened day its scans. Rows load when opened.
 */

import { useState } from 'react';
import type { ScanSummary } from '../../../types/database';
import type { ExperimentScanCount } from '../../../types/scan-groups';
import {
  dayKey,
  type ExportScanTree,
  type Loaded,
} from '../../hooks/useExportScanTree';
import { SearchIcon } from '../../../components/SearchIcon';
import { TriStateCheckbox } from './TriStateCheckbox';

/** "Oct 28, 2026" for a local day "2026-10-28". */
export function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function timeLabel(date: Date | string): string {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const scansText = (n: number) =>
  `${n.toLocaleString()} scan${n === 1 ? '' : 's'}`;

/** Case-insensitive, any part of the name. */
export function matchesSearch(name: string, search: string): boolean {
  const wanted = search.trim().toLowerCase();
  return wanted === '' || name.toLowerCase().includes(wanted);
}

function countSelected(scans: ScanSummary[], selected: Set<string>): number {
  return scans.filter((s) => selected.has(s.id)).length;
}

/** Loading or error for a row being opened; null once loaded. */
function RowStatus({
  state,
  what,
  onRetry,
}: {
  state: Loaded<unknown> | undefined;
  what: string;
  onRetry: () => void;
}) {
  if (!state || state.status === 'loading') {
    return <p className="px-4 py-2 text-sm text-gray-500">Loading {what}…</p>;
  }
  if (state.status === 'error') {
    return (
      <div className="flex items-center gap-3 px-4 py-2 text-sm">
        <span role="alert" className="text-red-600">
          Couldn&apos;t load {what}: {state.error}
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50"
        >
          Retry
        </button>
      </div>
    );
  }
  return null;
}

function Toggle({
  open,
  label,
  onClick,
}: {
  open: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="flex flex-1 items-center gap-2 rounded py-1 text-left text-sm hover:text-lime-800"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`h-5 w-5 shrink-0 text-lime-700 transition-transform ${
          open ? 'rotate-90' : ''
        }`}
      >
        <path d="M9 5l7 7-7 7" />
      </svg>
      {label}
    </button>
  );
}

export function ExportExperimentList({
  experiments,
  tree,
  disabled,
}: {
  experiments: ExperimentScanCount[];
  tree: ExportScanTree;
  /** While exporting, the selection can't change. */
  disabled: boolean;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const { days, dayScans, selected } = tree;

  /** Opens or closes a row; opening loads it (once: what loaded stays loaded). */
  const flip = (key: string, load: () => void) => {
    if (!open.has(key)) load();
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const dayState = (experimentId: string, day: string) => {
    const state = dayScans[dayKey(experimentId, day)];
    const scans = state?.status === 'loaded' ? state.data : [];
    const n = countSelected(scans, selected);
    return { all: scans.length > 0 && n === scans.length, some: n > 0 };
  };

  const experimentState = (experimentId: string) => {
    const state = days[experimentId];
    if (state?.status !== 'loaded') return { all: false, some: false };
    const perDay = state.data.map((d) => dayState(experimentId, d.day));
    return {
      all: perDay.length > 0 && perDay.every((d) => d.all),
      some: perDay.some((d) => d.some),
    };
  };

  const shown = experiments.filter((e) =>
    matchesSearch(e.experiment_name, search)
  );

  return (
    <div>
      <div className="border-b border-gray-200 p-3">
        <div className="relative">
          <SearchIcon />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search experiments…"
            aria-label="Search experiments"
            className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm"
          />
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="p-6 text-center text-sm text-gray-500">
          No experiments match &ldquo;{search.trim()}&rdquo;.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {shown.map((exp) => {
            const id = exp.experiment_id;
            const isOpen = open.has(id);
            const state = experimentState(id);
            const daysState = days[id];
            return (
              <li key={id}>
                <div className="flex items-center gap-3 bg-gray-50 px-4 py-3">
                  <TriStateCheckbox
                    allSelected={state.all}
                    someSelected={state.some}
                    disabled={disabled}
                    label={`Select all scans in ${exp.experiment_name}`}
                    onChange={(on) => tree.toggleExperiment(id, on)}
                  />
                  <Toggle
                    open={isOpen}
                    label={exp.experiment_name}
                    onClick={() => flip(id, () => tree.loadDays(id))}
                  />
                  <span className="text-sm text-gray-600">
                    {scansText(exp.scan_count)}
                  </span>
                </div>
                {isOpen && (
                  <>
                    <RowStatus
                      state={daysState}
                      what="its days"
                      onRetry={() => tree.loadDays(id)}
                    />
                    {daysState?.status === 'loaded' && (
                      <ul className="divide-y divide-gray-50">
                        {daysState.data.map(({ day, scan_count }) => {
                          const key = dayKey(id, day);
                          const dayOpen = open.has(key);
                          const ds = dayState(id, day);
                          const scansState = dayScans[key];
                          return (
                            <li key={key}>
                              <div className="flex items-center gap-3 px-4 py-2 pl-10">
                                <TriStateCheckbox
                                  allSelected={ds.all}
                                  someSelected={ds.some}
                                  disabled={disabled}
                                  label={`Select all scans on ${dayLabel(day)}`}
                                  onChange={(on) => tree.toggleDay(id, day, on)}
                                />
                                <Toggle
                                  open={dayOpen}
                                  label={dayLabel(day)}
                                  onClick={() =>
                                    flip(key, () => tree.loadDayScans(id, day))
                                  }
                                />
                                <span className="text-sm text-gray-600">
                                  {scansText(scan_count)}
                                </span>
                              </div>
                              {dayOpen && (
                                <>
                                  <RowStatus
                                    state={scansState}
                                    what="its scans"
                                    onRetry={() => tree.loadDayScans(id, day)}
                                  />
                                  {scansState?.status === 'loaded' && (
                                    <ul>
                                      {scansState.data.map((scan) => (
                                        <li
                                          key={scan.id}
                                          className="flex items-center gap-3 px-4 py-1.5 pl-16 text-sm"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={selected.has(scan.id)}
                                            disabled={disabled}
                                            onChange={(e) =>
                                              tree.toggleScan(
                                                scan.id,
                                                e.target.checked
                                              )
                                            }
                                            aria-label={`Select ${scan.plant_id} at ${timeLabel(scan.capture_date)}`}
                                            className="h-4 w-4 rounded border-gray-300"
                                          />
                                          <span className="text-gray-700">
                                            {scan.plant_id}
                                          </span>
                                          <span className="text-gray-500">
                                            {timeLabel(scan.capture_date)}
                                          </span>
                                          <span
                                            className="text-xs text-gray-400"
                                            title="Capturing scanner — shown because this list is not scoped to the current machine's scanner"
                                          >
                                            {scan.scanner_name}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
