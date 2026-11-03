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

export interface ScanGroupRow extends CameraValues {
  _count: { _all: number };
  _min: { capture_date: Date | null };
  _max: { capture_date: Date | null };
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
    groupBy(args: {
      by: ['exposure_time', 'gain', 'gamma'];
      where: {
        experiment_id: string;
        deleted: false;
        exposure_time: { gt: 0 };
      };
      _count: { _all: true };
      _min: { capture_date: true };
      _max: { capture_date: true };
    }): Promise<ScanGroupRow[]>;
    findFirst(args: {
      where: CameraValues & { experiment_id: string; deleted: false };
      orderBy: { capture_date: 'desc' };
      select: {
        images: {
          orderBy: { frame_number: 'asc' };
          take: 1;
          select: { path: true };
        };
      };
    }): Promise<{ images: Array<{ path: string }> } | null>;
  };
  experimentCameraSettings: SettingsTableLike;
  $transaction<T>(
    fn: (tx: { experimentCameraSettings: SettingsTableLike }) => Promise<T>
  ): Promise<T>;
}
