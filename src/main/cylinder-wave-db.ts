/**
 * The rows and the part of the Prisma client that the CylinderScan wave handlers
 * use (cylinder-wave-handlers.ts), so tests can pass a fake.
 */

export interface WaveRow {
  id: string;
  experiment_id: string;
  wave_number: number;
  germination_date: string;
  sowing_date: string | null;
  transfer_date: string | null;
  note: string | null;
  set_by_phenotyper_id: string | null;
  updatedAt: Date;
}

export interface ChangeRow {
  id: string;
  wave_id: string;
  old_germination_date: string | null;
  new_germination_date: string;
  old_sowing_date: string | null;
  new_sowing_date: string | null;
  old_transfer_date: string | null;
  new_transfer_date: string | null;
  reason: string | null;
  changed_by_phenotyper_id: string | null;
  changedAt: Date;
}

/** The part of the Prisma client the handlers use. */
export interface CylinderWaveDbLike {
  cylinderWave: {
    findMany: (args: {
      where: { experiment_id: string };
      orderBy: { wave_number: 'asc' };
    }) => Promise<WaveRow[]>;
    findUnique: (args: { where: { id: string } }) => Promise<WaveRow | null>;
    create: (args: {
      data: {
        experiment_id: string;
        wave_number: number;
        germination_date: string;
        sowing_date: string;
        transfer_date: string | null;
        note: string | null;
        set_by_phenotyper_id: string | null;
      };
    }) => Promise<WaveRow>;
  };
  scan: {
    groupBy: (args: {
      by: ['experiment_id', 'wave_number'];
      where: {
        experiment_id: { in: string[] };
        wave_number: { in: number[] };
        deleted: boolean;
      };
      _count: { _all: true };
    }) => Promise<
      { experiment_id: string; wave_number: number; _count: { _all: number } }[]
    >;
  };
  cylinderWaveDateChange: {
    findMany: (args: {
      where: { wave_id: { in: string[] } };
      orderBy: { changedAt: 'asc' };
    }) => Promise<ChangeRow[]>;
  };
  phenotyper: {
    findMany: (args: {
      where: { id: { in: string[] } };
      select: { id: true; name: true };
    }) => Promise<{ id: string; name: string }[]>;
  };
  $transaction: <T>(fn: (tx: CylinderWaveTxLike) => Promise<T>) => Promise<T>;
}

export interface CylinderWaveTxLike {
  cylinderWave: {
    create: CylinderWaveDbLike['cylinderWave']['create'];
    update: (args: {
      where: { id: string };
      data: {
        germination_date: string;
        sowing_date: string;
        transfer_date: string | null;
        set_by_phenotyper_id?: string;
      };
    }) => Promise<WaveRow>;
  };
  cylinderWaveDateChange: {
    create: (args: {
      data: {
        wave_id: string;
        old_germination_date: string | null;
        new_germination_date: string;
        old_sowing_date: string | null;
        new_sowing_date: string;
        old_transfer_date: string | null;
        new_transfer_date: string | null;
        reason: string | null;
        changed_by_phenotyper_id: string | null;
      };
    }) => Promise<unknown>;
  };
}
