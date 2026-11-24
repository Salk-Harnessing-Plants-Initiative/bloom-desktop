/**
 * The Experiments page's order: experiments with no scans yet first (most likely just
 * made), by name, then the one scanned most recently. The experiments table has no
 * created date, so the newest scan stands in for "recent".
 */

import type { ExperimentLatestScan } from '../../types/experiment-recency';

export function orderByRecentScan<T extends { id: string; name: string }>(
  experiments: T[],
  latestScans: ExperimentLatestScan[]
): T[] {
  const latest = new Map(
    latestScans.map((s) => [s.experiment_id, s.latest_ms])
  );
  return [...experiments].sort((a, b) => {
    const la = latest.get(a.id);
    const lb = latest.get(b.id);
    if (la === undefined && lb === undefined)
      return a.name.localeCompare(b.name);
    if (la === undefined) return -1;
    if (lb === undefined) return 1;
    return lb - la || a.name.localeCompare(b.name);
  });
}
