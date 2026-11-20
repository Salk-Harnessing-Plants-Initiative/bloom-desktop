/**
 * Main-process check that keeps file-name markers (`st`, `et`, `wave<N>`,
 * `cy<N>`, `Sc<N>`) out of GraviScan experiment names, so a name cannot
 * get in by a route other than the Experiment form. CylinderScan names are
 * not checked. Existing experiments are not blocked from scanning.
 */
import { graviscanExpNameError } from '../utils/graviscan-exp-name';

const GRAVISCAN_EXPERIMENT_TYPE = 'graviscan';

export interface ExperimentLookupLike {
  experiment: {
    findUnique(args: {
      where: { id: string };
      select: { name: true; experiment_type: true };
    }): Promise<{ name: string; experiment_type: string } | null>;
  };
}

/** A Prisma string field in update data: a value or `{ set: value }`. */
type StringUpdate = string | { set?: string } | undefined;

function updatedString(field: unknown): string | undefined {
  const value = field as StringUpdate;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.set === 'string') {
    return value.set;
  }
  return undefined;
}

/** Error for creating this experiment, or null when it is allowed. */
export function experimentCreateNameError(data: {
  name: string;
  experiment_type?: string | null;
}): string | null {
  if (data.experiment_type !== GRAVISCAN_EXPERIMENT_TYPE) return null;
  return graviscanExpNameError(data.name);
}

/**
 * Error for this update, or null when it is allowed. Checked only when the
 * name or the type changes and the result is a GraviScan experiment.
 */
export async function experimentUpdateNameError(
  db: ExperimentLookupLike,
  id: string,
  data: Record<string, unknown>
): Promise<string | null> {
  const newName = updatedString(data.name);
  const newType = updatedString(data.experiment_type);
  if (newName === undefined && newType === undefined) return null;

  const existing = await db.experiment.findUnique({
    where: { id },
    select: { name: true, experiment_type: true },
  });
  if (!existing) return null;

  const type = newType ?? existing.experiment_type;
  if (type !== GRAVISCAN_EXPERIMENT_TYPE) return null;
  return graviscanExpNameError(newName ?? existing.name);
}
