/**
 * Scans counted by experiment and by day, for Export Scans (#436): enough to list
 * experiments and their days without loading the scans themselves.
 */

/** An experiment with non-deleted scans, and how many. */
export interface ExperimentScanCount {
  experiment_id: string;
  experiment_name: string;
  scan_count: number;
}

/** A local calendar day ("YYYY-MM-DD") on which an experiment has scans. */
export interface ExperimentScanDay {
  day: string;
  scan_count: number;
}
