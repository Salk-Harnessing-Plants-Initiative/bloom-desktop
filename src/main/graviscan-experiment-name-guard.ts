/**
 * Main-process check that keeps file-name markers (`st`, `et`, `wave<N>`,
 * `cy<N>`, `Sc<N>`) out of new GraviScan experiment names created through
 * `db:experiments:create`, so the rule holds even if the Experiment form is
 * bypassed. CylinderScan names are not checked. Existing experiments are not
 * blocked from scanning.
 *
 * `db:experiments:update` is not checked: nothing in the app renames an
 * experiment, and whether that request stays is decided in #488.
 */
import { graviscanExpNameError } from '../utils/graviscan-exp-name';

const GRAVISCAN_EXPERIMENT_TYPE = 'graviscan';

/** Error for creating this experiment, or null when it is allowed. */
export function experimentCreateNameError(data: {
  name: string;
  experiment_type?: string | null;
}): string | null {
  if (data.experiment_type !== GRAVISCAN_EXPERIMENT_TYPE) return null;
  return graviscanExpNameError(data.name);
}
