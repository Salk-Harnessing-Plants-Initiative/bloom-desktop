/** When an experiment was last scanned, for ordering the Experiments page. */
export interface ExperimentLatestScan {
  experiment_id: string;
  /** The newest non-deleted scan's capture time, in ms since 1970. */
  latest_ms: number;
}
