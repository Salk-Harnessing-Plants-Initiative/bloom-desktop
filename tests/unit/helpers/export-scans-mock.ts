/**
 * window.electron.database.scans for Export Scans tests (#436): experiment counts,
 * an experiment's local days, and a day's scans, all worked out from one list of
 * scans the way the main process does.
 */

import { vi } from 'vitest';

export interface MockScan {
  id: string;
  experiment_id: string;
  plant_id: string;
  capture_date: Date;
  scanner_name: string;
  experiment: { name: string };
}

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;

export function mockScans(win: Window, scans: MockScan[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (win as any).electron.database.scans;

  const names = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const s of scans) {
    names.set(s.experiment_id, s.experiment.name);
    counts.set(s.experiment_id, (counts.get(s.experiment_id) ?? 0) + 1);
  }
  api.experimentCounts = vi.fn().mockResolvedValue({
    success: true,
    data: [...counts]
      .map(([experiment_id, scan_count]) => ({
        experiment_id,
        experiment_name: names.get(experiment_id)!,
        scan_count,
      }))
      .sort((a, b) => a.experiment_name.localeCompare(b.experiment_name)),
  });

  api.experimentDays = vi.fn(async (experimentId: string) => {
    const perDay = new Map<string, number>();
    for (const s of scans.filter((s) => s.experiment_id === experimentId)) {
      const day = localDay(s.capture_date);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    return {
      success: true,
      data: [...perDay]
        .map(([day, scan_count]) => ({ day, scan_count }))
        .sort((a, b) => b.day.localeCompare(a.day)),
    };
  });

  api.list = vi.fn(
    async (filters: {
      experimentId: string;
      dateFrom: string;
      page: number;
      pageSize: number;
    }) => {
      const day = scans.filter(
        (s) =>
          s.experiment_id === filters.experimentId &&
          localDay(s.capture_date) === filters.dateFrom
      );
      return {
        success: true,
        data: {
          scans: day,
          total: day.length,
          page: filters.page,
          pageSize: filters.pageSize,
        },
      };
    }
  );
  return api;
}
