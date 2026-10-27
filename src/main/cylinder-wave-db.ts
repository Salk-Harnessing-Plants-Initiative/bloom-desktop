/**
 * The rows and the part of the Prisma client that the CylinderScan wave and plant
 * handlers use (cylinder-wave-handlers.ts, cylinder-plant-handlers.ts), so tests can
 * pass a fake.
 */

/** A set of dates as stored: "YYYY-MM-DD"; a null transfer date is the germination day. */
export interface DateColumns {
  germination_date: string;
  sowing_date: string | null;
  transfer_date: string | null;
}

export interface WaveRow {
  id: string;
  experiment_id: string;
  wave_number: number;
  dates_per_plant: boolean;
  /** Null when the dates are per plant. */
  germination_date: string | null;
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
  new_germination_date: string | null;
  old_sowing_date: string | null;
  new_sowing_date: string | null;
  old_transfer_date: string | null;
  new_transfer_date: string | null;
  reason: string | null;
  changed_by_phenotyper_id: string | null;
  changedAt: Date;
}

export interface PlantRow extends DateColumns {
  id: string;
  wave_id: string;
  plant_barcode: string;
  uses_wave_dates: boolean;
  reason: string | null;
  set_by_phenotyper_id: string | null;
  updatedAt: Date;
}

export interface PlantChangeRow {
  id: string;
  plant_id: string;
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

type WaveCreateData = {
  experiment_id: string;
  wave_number: number;
  dates_per_plant: boolean;
  germination_date: string | null;
  sowing_date: string | null;
  transfer_date: string | null;
  note: string | null;
  set_by_phenotyper_id: string | null;
};

type PlantKey = {
  wave_id_plant_barcode: { wave_id: string; plant_barcode: string };
};

type PlantData = DateColumns & {
  uses_wave_dates: boolean;
  reason: string | null;
  set_by_phenotyper_id: string | null;
};

/** The part of the Prisma client the handlers use. */
export interface CylinderWaveDbLike {
  cylinderWave: {
    findMany: (args: {
      where: { experiment_id: string };
      orderBy: { wave_number: 'asc' };
    }) => Promise<WaveRow[]>;
    findUnique: (args: { where: { id: string } }) => Promise<WaveRow | null>;
    create: (args: { data: WaveCreateData }) => Promise<WaveRow>;
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
    count: (args: {
      where: { cylinder_plant_id: { in: string[] }; deleted: boolean };
    }) => Promise<number>;
  };
  cylinderWaveDateChange: {
    findMany: (args: {
      where: { wave_id: { in: string[] } };
      orderBy: { changedAt: 'asc' };
    }) => Promise<ChangeRow[]>;
  };
  cylinderPlant: {
    findMany: (args: {
      where: { wave_id: { in: string[] }; uses_wave_dates?: boolean };
      orderBy: { updatedAt: 'desc' };
    }) => Promise<PlantRow[]>;
    findUnique: (args: { where: PlantKey }) => Promise<PlantRow | null>;
  };
  cylinderPlantDateChange: {
    findMany: (args: {
      where: { plant_id: { in: string[] } };
      orderBy: { changedAt: 'asc' };
    }) => Promise<PlantChangeRow[]>;
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
        /** Null when the wave's dates become per plant. */
        germination_date: string | null;
        sowing_date: string | null;
        transfer_date: string | null;
        set_by_phenotyper_id?: string;
        /** Switching between one set of dates for all plants and dates per plant. */
        dates_per_plant?: boolean;
      };
    }) => Promise<WaveRow>;
  };
  cylinderWaveDateChange: {
    create: (args: {
      data: {
        wave_id: string;
        old_germination_date: string | null;
        new_germination_date: string | null;
        old_sowing_date: string | null;
        new_sowing_date: string | null;
        old_transfer_date: string | null;
        new_transfer_date: string | null;
        reason: string | null;
        changed_by_phenotyper_id: string | null;
      };
    }) => Promise<unknown>;
  };
  cylinderPlant: {
    findMany: CylinderWaveDbLike['cylinderPlant']['findMany'];
    create: (args: {
      data: PlantData & { wave_id: string; plant_barcode: string };
    }) => Promise<PlantRow>;
    update: (args: { where: PlantKey; data: PlantData }) => Promise<PlantRow>;
    /** A correction to the wave's dates reaches the plants still on them. */
    updateMany: (args: {
      where: { wave_id: string; uses_wave_dates: true };
      /** The wave's corrected dates, or uses_wave_dates: false when it goes per plant. */
      data: DateColumns | { uses_wave_dates: false };
    }) => Promise<{ count: number }>;
  };
  cylinderPlantDateChange: {
    create: (args: {
      data: Omit<PlantChangeRow, 'id' | 'changedAt'>;
    }) => Promise<unknown>;
  };
}
