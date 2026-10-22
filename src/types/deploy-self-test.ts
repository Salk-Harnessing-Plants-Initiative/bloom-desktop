/**
 * Types for the deploy self-test (`--deploy-self-test`), which the station
 * deploy runs after installing to prove an upload to Bloom works from the
 * installed build.
 */

/** Options parsed from the command line. */
export interface DeploySelfTestOptions {
  /** A migrated database the self-test may write to; never the station's own. */
  databasePath: string;
  /** Bloom species the test experiment is filed under; must exist in Bloom. */
  species: string;
  /** Where the JSON result is written (a GUI app's stdout isn't visible on Windows). */
  resultFile: string;
}

/** What parsing the command line produced. */
export type DeploySelfTestRequest =
  | { kind: 'run'; options: DeploySelfTestOptions }
  | { kind: 'invalid'; error: string; resultFile?: string };

/** The JSON result written to the result file. */
export interface DeploySelfTestResult {
  ok: boolean;
  version: string;
  scanner: string;
  species: string;
  experiment: string;
  plantId: string;
  frames: number;
  uploaded: number;
  failed: number;
  errors: string[];
  startedAt: string;
  finishedAt: string;
}
