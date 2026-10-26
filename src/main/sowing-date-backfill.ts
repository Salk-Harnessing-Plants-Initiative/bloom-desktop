/**
 * Start dates for waves scanned before start dates existed (#407).
 *
 * Run by hand after installing (`Bloom Desktop.exe --backfill-sowing-dates`, see
 * sowing-date-backfill-cli.ts): every CylinderScan wave that has scans but no start
 * date gets the date most of its scans imply (see src/utils/sowing-date-backfill.ts).
 * Each date is logged as set by admin, with the other dates a disputed wave's scans
 * point to, so the Experiments page shows them. Scans whose typed age doesn't fit
 * their wave's date are listed, never changed. Waves that already have a date are
 * never touched, so running it again changes nothing.
 */

import type {
  AgeMismatch,
  SowingDateBackfillResult,
  SowingDateBackfillWave,
} from '../types/cylinder-wave';
import {
  backfillReason,
  planBackfill,
  type EarlierScan,
  type WavePlan,
} from '../utils/sowing-date-backfill';

/** The writes for one wave, in one transaction. */
export interface SowingDateBackfillTxLike {
  cylinderWave: {
    create: (args: {
      data: {
        experiment_id: string;
        wave_number: number;
        sowing_date: string;
        note: null;
        set_by_phenotyper_id: null;
      };
    }) => Promise<{ id: string }>;
  };
  cylinderWaveSowingDateChange: {
    create: (args: {
      data: {
        wave_id: string;
        old_sowing_date: null;
        new_sowing_date: string;
        reason: string;
        changed_by_phenotyper_id: null;
      };
    }) => Promise<unknown>;
  };
}

/** The part of the Prisma client the backfill uses. */
export interface SowingDateBackfillDbLike {
  scan: {
    findMany: (args: {
      where: { deleted: boolean; experiment: { experiment_type: string } };
      select: {
        experiment_id: true;
        wave_number: true;
        plant_id: true;
        capture_date: true;
        plant_age_days: true;
      };
    }) => Promise<EarlierScan[]>;
  };
  cylinderWave: {
    findMany: (args: {
      select: { experiment_id: true; wave_number: true };
    }) => Promise<{ experiment_id: string; wave_number: number }[]>;
  };
  experiment: {
    findMany: (args: {
      where: { id: { in: string[] } };
      select: { id: true; name: true };
    }) => Promise<{ id: string; name: string }[]>;
  };
  $transaction: <T>(
    fn: (tx: SowingDateBackfillTxLike) => Promise<T>
  ) => Promise<T>;
}

const CYLINDERSCAN = 'cylinderscan';

const waveKey = (experimentId: string, waveNumber: number) =>
  `${experimentId}\u0000${waveNumber}`;

/** Plans for the waves that have scans but no start date. */
async function undatedWavePlans(
  db: SowingDateBackfillDbLike
): Promise<WavePlan[]> {
  const scans = await db.scan.findMany({
    where: { deleted: false, experiment: { experiment_type: CYLINDERSCAN } },
    select: {
      experiment_id: true,
      wave_number: true,
      plant_id: true,
      capture_date: true,
      plant_age_days: true,
    },
  });
  const dated = new Set(
    (
      await db.cylinderWave.findMany({
        select: { experiment_id: true, wave_number: true },
      })
    ).map((w) => waveKey(w.experiment_id, w.wave_number))
  );
  return planBackfill(
    scans.filter((s) => !dated.has(waveKey(s.experiment_id, s.wave_number)))
  );
}

/**
 * Set every undated wave's start date, and list the scans whose age doesn't fit it.
 * With `dryRun`, nothing is written: `set` lists the waves that would be set.
 */
export async function backfillSowingDates(
  db: SowingDateBackfillDbLike,
  log: (message: string) => void = console.log,
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<SowingDateBackfillResult> {
  const plans = await undatedWavePlans(db);
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
  const experiment = (p: WavePlan) =>
    names.get(p.experiment_id) ?? p.experiment_id;
  const describe = (p: WavePlan): SowingDateBackfillWave => ({
    experiment: experiment(p),
    wave_number: p.wave_number,
    scanCount: p.scanCount,
    agreeing: p.agreeing,
    sowingDate: p.sowingDate,
    disputed: p.disputed,
    candidates: p.candidates,
  });

  const result: SowingDateBackfillResult = {
    set: [],
    failed: [],
    ageMismatches: [],
  };
  for (const plan of plans) {
    result.ageMismatches.push(
      ...plan.mismatches.map(
        (m): AgeMismatch => ({
          experiment: experiment(plan),
          wave_number: plan.wave_number,
          ...m,
        })
      )
    );
    if (dryRun) {
      result.set.push(describe(plan));
      continue;
    }
    try {
      // The date and its first log entry together, so the history is never missing it.
      await db.$transaction(async (tx) => {
        const wave = await tx.cylinderWave.create({
          data: {
            experiment_id: plan.experiment_id,
            wave_number: plan.wave_number,
            sowing_date: plan.sowingDate,
            note: null,
            set_by_phenotyper_id: null,
          },
        });
        await tx.cylinderWaveSowingDateChange.create({
          data: {
            wave_id: wave.id,
            old_sowing_date: null,
            new_sowing_date: plan.sowingDate,
            reason: backfillReason(plan),
            changed_by_phenotyper_id: null,
          },
        });
      });
      result.set.push(describe(plan));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log(
        `[SowingDateBackfill] Couldn't set wave ${plan.wave_number} of ${experiment(plan)}: ${message}`
      );
      result.failed.push({
        experiment: experiment(plan),
        wave_number: plan.wave_number,
        error: message,
      });
    }
  }
  log(
    `[SowingDateBackfill] ${dryRun ? 'Would set' : 'Set'} ${result.set.length} wave(s); ` +
      `${result.failed.length} failed; ${result.ageMismatches.length} scan(s) with a mismatched age.`
  );
  return result;
}
