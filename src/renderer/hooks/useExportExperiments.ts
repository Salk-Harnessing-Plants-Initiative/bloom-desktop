/**
 * Export Scans' experiment rows (#436, #471): every experiment with scans, loaded once
 * (also for the "of N scans" total), and the experiments matching the search, loaded
 * again whenever it changes.
 */

import { useEffect, useState } from 'react';
import type { ExperimentScanCount, ScanFilter } from '../../types/scan-groups';
import { isEmptyFilter } from '../../utils/scan-search';

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

async function fetchCounts(
  filter?: ScanFilter
): Promise<ExperimentScanCount[]> {
  const result = await window.electron.database.scans.experimentCounts(filter);
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to load experiments');
  }
  return result.data;
}

export function useExportExperiments(filter: ScanFilter) {
  const [all, setAll] = useState<ExperimentScanCount[] | null>(null);
  const [matching, setMatching] = useState<ExperimentScanCount[] | null>(null);
  // Kept apart, so clearing the filter doesn't show the filtered load's error.
  const [allError, setAllError] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const filterKey = JSON.stringify(filter);
  const filtered = !isEmptyFilter(filter);

  useEffect(() => {
    let cancelled = false;
    fetchCounts()
      .then((data) => {
        if (!cancelled) setAll(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAllError(errorText(error, 'Failed to load experiments'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!filtered) {
      setMatching(null);
      return;
    }
    let cancelled = false;
    setMatching(null);
    setMatchError(null);
    fetchCounts(JSON.parse(filterKey) as ScanFilter)
      .then((data) => {
        if (!cancelled) setMatching(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMatchError(errorText(error, 'Failed to load experiments'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filterKey, filtered]);

  const experiments = filtered ? matching : all;
  const scanTotal = (list: ExperimentScanCount[] | null) =>
    (list ?? []).reduce((n, e) => n + e.scan_count, 0);

  return {
    /** The rows to list; null while loading. */
    experiments,
    loadError: filtered ? matchError : allError,
    filtered,
    matchingScans: scanTotal(experiments),
    /** Every scan's count; null until the unfiltered list has loaded. */
    totalScans: all === null ? null : scanTotal(all),
  };
}
