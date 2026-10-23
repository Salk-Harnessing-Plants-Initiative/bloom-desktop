/**
 * Sowing dates for waves scanned before sowing dates existed (#407).
 *
 * Run by hand after installing (`Bloom Desktop.exe --backfill-sowing-dates`, see
 * sowing-date-backfill-cli.ts): every CylinderScan wave that has scans but no
 * sowing date gets the date its scans imply, when nearly all of them agree (see
 * src/utils/sowing-date-backfill.ts); the rest are left for the operator, who sees
 * what the scans point to when first scanning that wave. Waves that already have
 * a date are never touched, so running it again changes nothing.
 */

import type { IpcMain } from 'electron';
import type { DatabaseResponse } from '../types/database';
import type {
  EarlierScansInfo,
  SowingDateBackfillResult,
  SowingDateBackfillWave,
} from '../types/cylinder-wave';
import {
  planBackfill,
  type EarlierScan,
  type WavePlan,
} from '../utils/sowing-date-backfill';

/** The part of the Prisma client the backfill uses. */
export interface SowingDateBackfillDbLike {
  scan: {
    findMany: (args: {
      where: {
        deleted: boolean;
        experiment: { experiment_type: string };
        experiment_id?: string;
      };
      select: {
        experiment_id: true;
        wave_number: true;
        capture_date: true;
        plant_age_days: true;
      };
    }) => Promise<EarlierScan[]>;
  };
  cylinderWave: {
    findMany: (args: {
      where?: { experiment_id: string };
      select: { experiment_id: true; wave_number: true };
    }) => Promise<{ experiment_id: string; wave_number: number }[]>;
    create: (args: {
      data: {
        experiment_id: string;
        wave_number: number;
        sowing_date: string;
        note: string;
        set_by_phenotyper_id: null;
      };
    }) => Promise<unknown>;
  };
  experiment: {
    findMany: (args: {
      where: { id: { in: string[] } };
      select: { id: true; name: true };
    }) => Promise<{ id: string; name: string }[]>;
  };
}

const CYLINDERSCAN = 'cylinderscan';

/** The note on a wave whose date was worked out from its earlier scans. */
export function backfillNote(plan: WavePlan): string {
  return `Worked out from ${plan.agreeing} of ${plan.scanCount} earlier scans.`;
}

/** Plans for the waves (of one experiment, or all) that have scans but no sowing date. */
async function undatedWavePlans(
  db: SowingDateBackfillDbLike,
  experimentId?: string
): Promise<{ plans: WavePlan[]; scannedWaveNumbers: Map<string, number[]> }> {
  const scope = experimentId ? { experiment_id: experimentId } : {};
  const scans = await db.scan.findMany({
    where: {
      deleted: false,
      experiment: { experiment_type: CYLINDERSCAN },
      ...scope,
    },
    select: {
      experiment_id: true,
      wave_number: true,
      capture_date: true,
      plant_age_days: true,
    },
  });
  const dated = new Set(
    (
      await db.cylinderWave.findMany({
        ...(experimentId ? { where: scope as { experiment_id: string } } : {}),
        select: { experiment_id: true, wave_number: true },
      })
    ).map((w) => `${w.experiment_id}\u0000${w.wave_number}`)
  );
  const scannedWaveNumbers = new Map<string, number[]>();
  for (const s of scans) {
    const waves = scannedWaveNumbers.get(s.experiment_id) ?? [];
    if (!waves.includes(s.wave_number)) waves.push(s.wave_number);
    scannedWaveNumbers.set(s.experiment_id, waves);
  }
  const plans = planBackfill(
    scans.filter((s) => !dated.has(`${s.experiment_id}\u0000${s.wave_number}`))
  );
  return { plans, scannedWaveNumbers };
}

/**
 * What a wave's earlier scans point to, for Capture Scan's "Please set the
 * sowing date" box and for the check when the date is saved.
 */
export async function earlierScans(
  db: SowingDateBackfillDbLike,
  experimentId: string,
  waveNumber: number
): Promise<EarlierScansInfo> {
  const { plans, scannedWaveNumbers } = await undatedWavePlans(
    db,
    experimentId
  );
  const plan = plans.find((p) => p.wave_number === waveNumber);
  return {
    scanCount: plan?.scanCount ?? 0,
    agreeing: plan?.agreeing ?? 0,
    candidates: plan?.candidates ?? [],
    scannedWaveNumbers: (scannedWaveNumbers.get(experimentId) ?? []).sort(
      (a, b) => a - b
    ),
  };
}

/**
 * Set every undated wave whose earlier scans agree; report the rest. With
 * `dryRun`, nothing is written: `set` lists the waves that would be set.
 */
export async function backfillSowingDates(
  db: SowingDateBackfillDbLike,
  log: (message: string) => void = console.log,
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<SowingDateBackfillResult> {
  const { plans } = await undatedWavePlans(db);
  const ids = [...new Set(plans.map((p) => p.experiment_id))];
  const names = new Map(
    ids.length > 0
      ? (
          await db.experiment.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          })
        ).map((e) => [e.id, e.name])
      : []
  );
  const describe = (p: WavePlan): SowingDateBackfillWave => ({
    experiment: names.get(p.experiment_id) ?? p.experiment_id,
    wave_number: p.wave_number,
    scanCount: p.scanCount,
    agreeing: p.agreeing,
    sowingDate: p.sowingDate,
    candidates: p.candidates.slice(0, 3),
  });

  const result: SowingDateBackfillResult = { set: [], leftForOperator: [] };
  for (const plan of plans) {
    if (!plan.sowingDate) {
      result.leftForOperator.push(describe(plan));
      continue;
    }
    if (dryRun) {
      result.set.push(describe(plan));
      continue;
    }
    try {
      await db.cylinderWave.create({
        data: {
          experiment_id: plan.experiment_id,
          wave_number: plan.wave_number,
          sowing_date: plan.sowingDate,
          note: backfillNote(plan),
          set_by_phenotyper_id: null,
        },
      });
      result.set.push(describe(plan));
    } catch (error) {
      // Set by an operator meanwhile (unique on experiment and wave): leave theirs.
      log(
        `[SowingDateBackfill] Skipped wave ${plan.wave_number} of ${describe(plan).experiment}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }
  if (result.set.length > 0 || result.leftForOperator.length > 0) {
    log(
      `[SowingDateBackfill] ${dryRun ? 'Would set' : 'Set'} ${result.set.length} wave(s) from earlier scans; ` +
        `left ${result.leftForOperator.length} for the operator.`
    );
  }
  return result;
}

export function registerSowingDateBackfillHandlers(deps: {
  ipcMain: Pick<IpcMain, 'handle'>;
  db: SowingDateBackfillDbLike;
}): void {
  deps.ipcMain.handle(
    'db:cylinderWaves:earlierScans',
    async (
      _event,
      experimentId: string,
      waveNumber: number
    ): Promise<DatabaseResponse<EarlierScansInfo>> => {
      if (typeof experimentId !== 'string' || !experimentId.trim()) {
        return {
          success: false,
          error: 'experimentId must be a non-empty string',
        };
      }
      if (!Number.isInteger(waveNumber) || waveNumber < 0) {
        return {
          success: false,
          error: 'waveNumber must be a non-negative integer',
        };
      }
      try {
        return {
          success: true,
          data: await earlierScans(deps.db, experimentId, waveNumber),
        };
      } catch (error) {
        console.error('[SowingDateBackfill]', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );
}
