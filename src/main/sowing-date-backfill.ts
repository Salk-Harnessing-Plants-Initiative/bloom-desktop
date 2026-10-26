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
        id: true;
        experiment_id: true;
        wave_number: true;
        plant_id: true;
        accession_name: true;
        phenotyper_id: true;
        scanner_name: true;
        path: true;
        capture_date: true;
        plant_age_days: true;
      };
    }) => Promise<EarlierScan[]>;
  };
  image: {
    groupBy: (args: {
      by: ['scan_id', 'status'];
      where: { scan_id: { in: string[] } };
      _count: { _all: true };
    }) => Promise<
      { scan_id: string; status: string; _count: { _all: number } }[]
    >;
  };
  phenotyper: {
    findMany: (args: {
      where: { id: { in: string[] } };
      select: { id: true; name: true };
    }) => Promise<{ id: string; name: string }[]>;
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
      id: true,
      experiment_id: true,
      wave_number: true,
      plant_id: true,
      accession_name: true,
      phenotyper_id: true,
      scanner_name: true,
      path: true,
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

/** How many ids go in one `in` list, to stay well under SQLite's parameter limit. */
const LOOKUP_CHUNK_SIZE = 500;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += LOOKUP_CHUNK_SIZE) {
    out.push(items.slice(i, i + LOOKUP_CHUNK_SIZE));
  }
  return out;
}

/**
 * Each scan whose typed age doesn't fit its wave's date, with what's needed to find it
 * here and in Bloom: its ids, who scanned it, its folder, its capture time (Bloom's
 * date_scanned) and how many of its images were uploaded.
 */
async function describeMismatches(
  db: SowingDateBackfillDbLike,
  plans: WavePlan[],
  experiment: (p: WavePlan) => string
): Promise<AgeMismatch[]> {
  const found = plans.flatMap((plan) =>
    plan.mismatches.map((m) => ({ plan, m }))
  );
  if (found.length === 0) return [];
  const scanIds = found.map(({ m }) => m.scan.id);
  const phenotyperIds = [
    ...new Set(found.map(({ m }) => m.scan.phenotyper_id)),
  ];
  const names = new Map<string, string>();
  for (const ids of chunks(phenotyperIds)) {
    for (const p of await db.phenotyper.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    })) {
      names.set(p.id, p.name);
    }
  }
  const images = new Map<string, { uploaded: number; total: number }>();
  for (const ids of chunks(scanIds)) {
    for (const g of await db.image.groupBy({
      by: ['scan_id', 'status'],
      where: { scan_id: { in: ids } },
      _count: { _all: true },
    })) {
      const counts = images.get(g.scan_id) ?? { uploaded: 0, total: 0 };
      counts.total += g._count._all;
      if (g.status === 'uploaded') counts.uploaded += g._count._all;
      images.set(g.scan_id, counts);
    }
  }
  return found.map(({ plan, m }) => ({
    scan_id: m.scan.id,
    experiment_id: plan.experiment_id,
    experiment: experiment(plan),
    wave_number: plan.wave_number,
    plant_id: m.scan.plant_id,
    accession_name: m.scan.accession_name,
    phenotyper: names.get(m.scan.phenotyper_id) ?? null,
    scanner_name: m.scan.scanner_name,
    path: m.scan.path,
    capture_date: m.scan.capture_date.toISOString(),
    captured: m.captured,
    typed_age: m.scan.plant_age_days,
    age_from_date: m.age_from_date,
    implied_start_date: m.implied_start_date,
    wave_start_date: plan.sowingDate,
    wave_disputed: plan.disputed,
    images_uploaded: images.get(m.scan.id)?.uploaded ?? 0,
    images_total: images.get(m.scan.id)?.total ?? 0,
  }));
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
  result.ageMismatches = await describeMismatches(db, plans, experiment);
  log(
    `[SowingDateBackfill] ${dryRun ? 'Would set' : 'Set'} ${result.set.length} wave(s); ` +
      `${result.failed.length} failed; ${result.ageMismatches.length} scan(s) with a mismatched age.`
  );
  return result;
}
