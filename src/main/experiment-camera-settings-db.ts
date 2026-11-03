/**
 * The rows and the part of the Prisma client that the experiment camera settings
 * handlers use (experiment-camera-settings-handlers.ts), so tests can pass a fake.
 */

import type { CameraValues } from '../types/experiment-camera-settings';

export interface SettingsRow extends CameraValues {
  id: string;
  experiment_id: string;
  note: string;
  set_by_phenotyper_id: string | null;
  createdAt: Date;
  last_confirmed_at: Date | null;
  last_confirmed_by_phenotyper_id: string | null;
}

/** A live scan's settings and when it was taken. */
export interface ScanSettingsRow extends CameraValues {
  id: string;
  capture_date: Date;
}

export type SettingsCreateData = CameraValues & {
  experiment_id: string;
  note: string;
  set_by_phenotyper_id: string;
  last_confirmed_at: Date;
  last_confirmed_by_phenotyper_id: string;
};

export interface SettingsTableLike {
  findMany(args: {
    where: { experiment_id: string };
    orderBy: Array<{ createdAt: 'desc' } | { id: 'desc' }>;
    take?: number;
  }): Promise<SettingsRow[]>;
  create(args: { data: SettingsCreateData }): Promise<SettingsRow>;
  update(args: {
    where: { id: string };
    data: { last_confirmed_at: Date; last_confirmed_by_phenotyper_id: string };
  }): Promise<SettingsRow>;
}

/** The part of the Prisma client these handlers use, so tests can pass a fake. */
export interface CameraSettingsDbLike {
  experiment: {
    findUnique(args: {
      where: { id: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  phenotyper: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; name: true };
    }): Promise<Array<{ id: string; name: string }>>;
  };
  scan: {
    findMany(args: {
      where: {
        experiment_id: string;
        deleted: false;
        exposure_time: { gt: 0 };
      };
      select: {
        id: true;
        exposure_time: true;
        gain: true;
        gamma: true;
        capture_date: true;
      };
    }): Promise<ScanSettingsRow[]>;
  };
  image: {
    findFirst(args: {
      where: { scan_id: string };
      orderBy: { frame_number: 'asc' };
      select: { path: true };
    }): Promise<{ path: string } | null>;
  };
  experimentCameraSettings: SettingsTableLike;
  $transaction<T>(
    fn: (tx: { experimentCameraSettings: SettingsTableLike }) => Promise<T>
  ): Promise<T>;
}
