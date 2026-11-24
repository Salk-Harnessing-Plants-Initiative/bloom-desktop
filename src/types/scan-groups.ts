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

/**
 * What Export Scans is filtered by; nothing set lists everything. Both parts that are
 * set must match. Dates are local "YYYY-MM-DD", both ends inclusive.
 */
export interface ScanFilter {
  /** Experiment name, phenotyper name, plant barcode, or a date like "Nov 20, 2026". */
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}
