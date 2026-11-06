/**
 * Export Scans' experiments → days → scans (#436). Only what is opened or ticked is
 * loaded: an experiment's days when it's opened, a day's scans when it's opened.
 * Ticking an experiment or day that isn't loaded loads it first, then selects its
 * scans; Export waits meanwhile (pending > 0). What has loaded stays loaded.
 */

import { useCallback, useRef, useState } from 'react';
import type { ScanSummary } from '../../types/database';
import type { ExperimentScanDay } from '../../types/scan-groups';

// Summaries carry no image rows, so a page can hold many (MAX_SUMMARY_PAGE_SIZE).
const SCANS_PAGE_SIZE = 1000;
// Guards against an endless loop if paging ever miscounts; a day is far smaller.
const MAX_SCAN_PAGES = 1000;

export type Loaded<T> =
  | { status: 'loading' }
  | { status: 'loaded'; data: T }
  | { status: 'error'; error: string };

export const dayKey = (experimentId: string, day: string) =>
  `${experimentId}__${day}`;

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

async function fetchDays(experimentId: string): Promise<ExperimentScanDay[]> {
  const result =
    await window.electron.database.scans.experimentDays(experimentId);
  if (!result.success || !result.data) {
    throw new Error(result.error ?? 'Unknown error');
  }
  return result.data;
}

/** One experiment's scans on one local day, page by page. */
async function fetchDayScans(
  experimentId: string,
  day: string
): Promise<ScanSummary[]> {
  const all: ScanSummary[] = [];
  for (let page = 1; page <= MAX_SCAN_PAGES; page++) {
    const result = await window.electron.database.scans.list({
      page,
      pageSize: SCANS_PAGE_SIZE,
      experimentId,
      dateFrom: day,
      dateTo: day,
      summary: true,
    });
    if (!result.success || !result.data) {
      throw new Error(result.error ?? 'Unknown error');
    }
    all.push(...result.data.scans);
    if (all.length >= result.data.total || result.data.scans.length === 0) {
      return all;
    }
  }
  throw new Error(`Scan pages did not end after ${MAX_SCAN_PAGES} pages`);
}

export function useExportScanTree() {
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

  const loadDays = useCallback((experimentId: string) => {
    let request = daysRequests.current.get(experimentId);
    if (!request) {
      setDays((prev) => ({ ...prev, [experimentId]: { status: 'loading' } }));
      request = fetchDays(experimentId);
      daysRequests.current.set(experimentId, request);
      request.then(
        (data) =>
          setDays((prev) => ({
            ...prev,
            [experimentId]: { status: 'loaded', data },
          })),
        (error: unknown) => {
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
      setDayScans((prev) => ({ ...prev, [key]: { status: 'loading' } }));
      request = fetchDayScans(experimentId, day);
      scanRequests.current.set(key, request);
      request.then(
        (data) => {
          loadedScans.current.set(key, data);
          setDayScans((prev) => ({
            ...prev,
            [key]: { status: 'loaded', data },
          }));
        },
        (error: unknown) => {
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
      const list = await loadDays(experimentId);
      const perDay = await Promise.all(
        list.map((d) => {
          // Its days follow the experiment, so unticking one later works.
          wanted.current.set(dayKey(experimentId, d.day), true);
          return loadDayScans(experimentId, d.day);
        })
      );
      return perDay.flat();
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
