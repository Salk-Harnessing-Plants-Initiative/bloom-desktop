/**
 * Export Scans' experiments → days → scans (#436). Only what is opened or ticked is
 * loaded: an experiment's days when it's opened, a day's scans when it's opened.
 * Ticking an experiment or day that isn't loaded loads it first, then selects its
 * scans; Export waits meanwhile (pending > 0). What has loaded stays loaded until
 * the filter changes (#471): then rows load again, filtered, and the selection stays.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScanSummary } from '../../types/database';
import type { ExperimentScanDay, ScanFilter } from '../../types/scan-groups';
import { toIsoDate } from '../../utils/wave-dates';

export type Loaded<T> =
  | { status: 'loading' }
  | { status: 'loaded'; data: T }
  | { status: 'error'; error: string };

export const dayKey = (experimentId: string, day: string) =>
  `${experimentId}__${day}`;

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

async function fetchDays(
  experimentId: string,
  filter: ScanFilter
): Promise<ExperimentScanDay[]> {
  const result = await window.electron.database.scans.experimentDays(
    experimentId,
    filter
  );
  if (!result.success || !result.data) {
    throw new Error(result.error ?? 'Unknown error');
  }
  return result.data;
}

/** One experiment's matching scans on one local day; null: on every day. */
async function fetchDayScans(
  experimentId: string,
  day: string | null,
  filter: ScanFilter
): Promise<ScanSummary[]> {
  const result = await window.electron.database.scans.dayScans(
    experimentId,
    day,
    filter
  );
  if (!result.success || !result.data) {
    throw new Error(result.error ?? 'Unknown error');
  }
  return result.data;
}

export function useExportScanTree(filter: ScanFilter = {}) {
  const [days, setDays] = useState<Record<string, Loaded<ExperimentScanDay[]>>>(
    {}
  );
  const [dayScans, setDayScans] = useState<
    Record<string, Loaded<ScanSummary[]>>
  >({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(0);

  // Requests made, so a row is fetched once; a failed one is dropped to retry.
  const daysRequests = useRef(new Map<string, Promise<ExperimentScanDay[]>>());
  const scanRequests = useRef(new Map<string, Promise<ScanSummary[]>>());
  // What each ticked row should end as once loaded: an untick while loading wins.
  const wanted = useRef(new Map<string, boolean>());
  // Each loaded day's scans, for unticking without waiting for state.
  const loadedScans = useRef(new Map<string, ScanSummary[]>());
  // The filter rows load with, and a count of filter changes: a row that finishes
  // loading after the filter changed is dropped, not shown under the new one.
  const filterRef = useRef(filter);
  const generation = useRef(0);
  const filterKey = JSON.stringify(filter);

  useEffect(() => {
    if (filterKey === JSON.stringify(filterRef.current)) return;
    filterRef.current = JSON.parse(filterKey) as ScanFilter;
    generation.current += 1;
    daysRequests.current.clear();
    scanRequests.current.clear();
    loadedScans.current.clear();
    // A row ticked under the old filter doesn't select once it loads.
    for (const key of wanted.current.keys()) wanted.current.set(key, false);
    setDays({});
    setDayScans({});
  }, [filterKey]);

  const loadDays = useCallback((experimentId: string) => {
    let request = daysRequests.current.get(experimentId);
    if (!request) {
      const asked = generation.current;
      setDays((prev) => ({ ...prev, [experimentId]: { status: 'loading' } }));
      request = fetchDays(experimentId, filterRef.current);
      daysRequests.current.set(experimentId, request);
      request.then(
        (data) => {
          if (asked !== generation.current) return;
          setDays((prev) => ({
            ...prev,
            [experimentId]: { status: 'loaded', data },
          }));
        },
        (error: unknown) => {
          if (asked !== generation.current) return;
          daysRequests.current.delete(experimentId);
          setDays((prev) => ({
            ...prev,
            [experimentId]: { status: 'error', error: message(error) },
          }));
        }
      );
    }
    return request;
  }, []);

  const loadDayScans = useCallback((experimentId: string, day: string) => {
    const key = dayKey(experimentId, day);
    let request = scanRequests.current.get(key);
    if (!request) {
      const asked = generation.current;
      setDayScans((prev) => ({ ...prev, [key]: { status: 'loading' } }));
      request = fetchDayScans(experimentId, day, filterRef.current);
      scanRequests.current.set(key, request);
      request.then(
        (data) => {
          if (asked !== generation.current) return;
          loadedScans.current.set(key, data);
          setDayScans((prev) => ({
            ...prev,
            [key]: { status: 'loaded', data },
          }));
        },
        (error: unknown) => {
          if (asked !== generation.current) return;
          scanRequests.current.delete(key);
          setDayScans((prev) => ({
            ...prev,
            [key]: { status: 'error', error: message(error) },
          }));
        }
      );
    }
    return request;
  }, []);

  /** All of an experiment's matching scans in one request, filed by day as if each
   * day had been opened. */
  const loadExperimentScans = useCallback(async (experimentId: string) => {
    const asked = generation.current;
    const scans = await fetchDayScans(experimentId, null, filterRef.current);
    if (asked !== generation.current) return scans;
    const byDay = new Map<string, ScanSummary[]>();
    for (const scan of scans) {
      const key = dayKey(experimentId, toIsoDate(new Date(scan.capture_date)));
      byDay.set(key, [...(byDay.get(key) ?? []), scan]);
    }
    for (const [key, list] of byDay) {
      loadedScans.current.set(key, list);
      scanRequests.current.set(key, Promise.resolve(list));
      // Its days follow the experiment, so unticking one later works.
      wanted.current.set(key, wanted.current.get(experimentId) === true);
    }
    setDayScans((prev) => {
      const next = { ...prev };
      for (const [key, list] of byDay) {
        next[key] = { status: 'loaded', data: list };
      }
      return next;
    });
    return scans;
  }, []);

  const setIds = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  /** Loads a row's scans, then selects them, unless it was unticked meanwhile. */
  const select = async (key: string, load: () => Promise<ScanSummary[]>) => {
    wanted.current.set(key, true);
    setPending((n) => n + 1);
    try {
      const scans = await load();
      if (wanted.current.get(key)) {
        setIds(
          scans.map((s) => s.id),
          true
        );
      }
    } catch {
      // The row shows why it couldn't load; nothing is selected from it.
    } finally {
      setPending((n) => n - 1);
    }
  };

  /** Unselects the loaded scans of these day keys: only loaded scans are selected. */
  const unselect = (keys: string[]) => {
    for (const key of keys) wanted.current.set(key, false);
    setIds(
      keys.flatMap((key) =>
        (loadedScans.current.get(key) ?? []).map((s) => s.id)
      ),
      false
    );
  };

  const toggleScan = (scanId: string, on: boolean) => setIds([scanId], on);

  /** After an export: nothing selected, and no ticked row still to select. */
  const clearSelection = useCallback(() => {
    for (const key of wanted.current.keys()) wanted.current.set(key, false);
    setSelected(new Set());
  }, []);

  const toggleDay = (experimentId: string, day: string, on: boolean) => {
    const key = dayKey(experimentId, day);
    if (!on) return unselect([key]);
    return select(key, () => loadDayScans(experimentId, day));
  };

  const toggleExperiment = (experimentId: string, on: boolean) => {
    if (!on) {
      const prefix = dayKey(experimentId, '');
      unselect([
        experimentId,
        ...[...loadedScans.current.keys(), ...wanted.current.keys()].filter(
          (key) => key.startsWith(prefix)
        ),
      ]);
      return;
    }
    return select(experimentId, async () => {
      const [, scans] = await Promise.all([
        loadDays(experimentId),
        loadExperimentScans(experimentId),
      ]);
      return scans;
    });
  };

  return {
    days,
    dayScans,
    selected,
    pending,
    loadDays,
    loadDayScans,
    toggleScan,
    toggleDay,
    toggleExperiment,
    clearSelection,
  };
}

export type ExportScanTree = ReturnType<typeof useExportScanTree>;
