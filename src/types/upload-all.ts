/**
 * Browse Scans' "Upload all" (#449): every scan with frames not yet uploaded, within
 * the page's filters, uploaded to Bloom one after another.
 */

/** Browse Scans' filters: the same scans the list shows. */
export interface ScanListFilters {
  experimentId?: string;
  /** YYYY-MM-DD, local time. */
  dateFrom?: string;
  /** YYYY-MM-DD, local time, inclusive. */
  dateTo?: string;
}

/** Sent after each scan while Upload all runs. */
export interface UploadAllProgress {
  /** Scans finished so far, including this one. */
  done: number;
  total: number;
  uploadedScans: number;
  failedScans: number;
}

/** How an Upload all run ended. */
export interface UploadAllResult {
  total: number;
  /** Scans whose frames all uploaded. */
  uploadedScans: number;
  /** Scans with at least one frame that didn't; they can be uploaded again. */
  failedScans: number;
  /** Stopped before every scan was tried. */
  stopped: boolean;
  /** The first few failures, "PLANT_ID: reason". */
  errors: string[];
}

/** How an Upload all run ended: its result, or why it couldn't run (e.g. no login). */
export interface UploadAllDone {
  result?: UploadAllResult;
  error?: string;
}

/**
 * Upload all as the main process remembers it, so Browse Scans shows a run (and its
 * Stop button and result) even after the page was left and opened again.
 */
export interface UploadAllStatus {
  running: boolean;
  /** The latest progress of the run going now. */
  progress: UploadAllProgress | null;
  /** How the last run ended, until it is dismissed or a new run starts. */
  last: UploadAllDone | null;
}
