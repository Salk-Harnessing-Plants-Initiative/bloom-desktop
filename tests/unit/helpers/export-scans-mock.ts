/**
 * window.electron.database.scans for Export Scans tests (#436, #471): experiment
 * counts, an experiment's local days, and a day's scans, all worked out from one list
 * of scans and filtered the way the main process does.
 */

import { vi } from 'vitest';
import type { ScanFilter } from '../../../src/types/scan-groups';
import { scanMatcher } from '../../../src/utils/scan-search';
import { readFilter } from '../../../src/main/scan-groups-handlers';

export interface MockScan {
  id: string;
  experiment_id: string;
  plant_id: string;
  capture_date: Date;
  scanner_name: string;
  experiment: { name: string };
  /** Defaults to "Test Phenotyper". */
  phenotyper_name?: string;
}

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;

export function mockScans(win: Window, scans: MockScan[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (win as any).electron.database.scans;

  const matching = (filter: ScanFilter = {}) => {
    const matches = scanMatcher(filter);
    return scans.filter((s) =>
      matches({
        plant_id: s.plant_id,
        capture_date: s.capture_date,
        experiment_name: s.experiment.name,
        phenotyper_name: s.phenotyper_name ?? 'Test Phenotyper',
      })
    );
  };

  api.experimentCounts = vi.fn(async (filter?: ScanFilter) => {
    const names = new Map<string, string>();
    const counts = new Map<string, number>();
    const latest = new Map<string, number>();
    for (const s of matching(filter)) {
      names.set(s.experiment_id, s.experiment.name);
      counts.set(s.experiment_id, (counts.get(s.experiment_id) ?? 0) + 1);
      latest.set(
        s.experiment_id,
        Math.max(latest.get(s.experiment_id) ?? 0, s.capture_date.getTime())
      );
    }
    return {
      success: true,
      data: [...counts]
        .map(([experiment_id, scan_count]) => ({
          experiment_id,
          experiment_name: names.get(experiment_id)!,
          scan_count,
        }))
        .sort(
          (a, b) =>
            latest.get(b.experiment_id)! - latest.get(a.experiment_id)! ||
            a.experiment_name.localeCompare(b.experiment_name)
        ),
    };
  });

  api.experimentDays = vi.fn(
    async (experimentId: string, filter?: ScanFilter) => {
      const perDay = new Map<string, number>();
      for (const s of matching(filter).filter(
        (s) => s.experiment_id === experimentId
      )) {
        const day = localDay(s.capture_date);
        perDay.set(day, (perDay.get(day) ?? 0) + 1);
      }
      return {
        success: true,
        data: [...perDay]
          .map(([day, scan_count]) => ({ day, scan_count }))
          .sort((a, b) => b.day.localeCompare(a.day)),
      };
    }
  );

  api.dayScans = vi.fn(
    async (experimentId: string, day: string | null, filter?: ScanFilter) => ({
      success: true,
      data: matching(filter).filter(
        (s) =>
          s.experiment_id === experimentId &&
          (day === null || localDay(s.capture_date) === day)
      ),
    })
  );

  // The main process refuses a filter it can't read, so these do too.
  const filterArg = { experimentCounts: 0, experimentDays: 1, dayScans: 2 };
  for (const [name, at] of Object.entries(filterArg)) {
    const answer = api[name];
    api[name] = vi.fn(async (...args: unknown[]) => {
      const checked = readFilter(args[at]);
      if (typeof checked === 'string') {
        return { success: false, error: checked };
      }
      return answer(...args);
    });
  }
  return api;
}
