/**
 * Type definitions for GraviScan external store interfaces.
 *
 * These types cover methods on @salk-hpi/bloom-js SupabaseStore that are
 * GraviScan-specific and not yet exported from the package's type definitions.
 * Once the package adds proper exports, this file can be removed.
 */

import type { SupabaseStore } from '@salk-hpi/bloom-js';
import type { PostgrestError } from '@supabase/postgrest-js';

// ---------------------------------------------------------------------------
// SupabaseStore GraviScan Extensions
// ---------------------------------------------------------------------------

/**
 * Parameters for inserting a GraviScan session into Supabase.
 */
export interface GraviScanSessionParams {
  species: string;
  experiment: string;
  phenotyper_name: string;
  phenotyper_email: string;
  scientist_name: string;
  scientist_email: string;
  accession_name?: string;
  scan_mode: string;
  interval_seconds?: number;
  duration_seconds?: number;
  total_cycles?: number;
  actual_duration_seconds?: number;
  completed_at?: string;
  cancelled: boolean;
  system_name?: string;
}

/**
 * Parameters for inserting GraviScan plate metadata into Supabase.
 */
export interface GraviScanMetadataParams {
  accession_name: string;
  plate_id: string;
  wave_number?: number;
  transplant_date: string | null;
  custom_note: string | null;
  sections: Array<{
    plate_section_id: string;
    plant_qr: string;
    medium: string | null;
  }>;
}

/**
 * Common return type for Supabase store insert/update operations.
 */
export interface StoreResult<T = number> {
  created: T;
  error: PostgrestError;
}

/**
 * GraviScan-specific methods on SupabaseStore.
 *
 * Usage: cast `store` to this interface instead of `any`:
 *   `(store as GraviScanStoreExtensions).insertGraviScanSession(params)`
 */
export interface GraviScanStoreExtensions extends SupabaseStore {
  updateGraviImageMetadata(
    scanId: number,
    data: {
      object_path: string;
      file_hash?: string;
      file_size_bytes?: number;
    }
  ): Promise<{ error: PostgrestError | null }>;

  insertGraviScanSession(params: GraviScanSessionParams): Promise<StoreResult>;

  insertGraviScanMetadata(
    params: GraviScanMetadataParams
  ): Promise<StoreResult>;
}

// ---------------------------------------------------------------------------
// Prisma Query Payload Types
// ---------------------------------------------------------------------------

import type { Prisma } from '@prisma/client';

/**
 * Experiment with nested GraviScans and all relations.
 * Matches the `include` used in `db:graviscans:browse-by-experiment`.
 */
export type ExperimentWithGraviScans = Prisma.ExperimentGetPayload<{
  include: {
    scientist: true;
    accession: true;
    graviscanScans: {
      include: {
        phenotyper: true;
        scanner: true;
        images: true;
        session: true;
      };
    };
    graviscanPlateAssignments: true;
  };
}>;

/**
 * Single GraviScan with all relations.
 */
export type GraviScanWithAllRelations =
  ExperimentWithGraviScans['graviscanScans'][number];

// ---------------------------------------------------------------------------
// GraviPlateAccession IPC Response Types
// ---------------------------------------------------------------------------

/**
 * Section data within a GraviPlateAccession, returned by `graviPlateAccessions.list()`.
 */
export interface GraviPlateSectionData {
  id: string;
  plate_section_id: string;
  plant_qr: string;
  medium: string | null;
}

/**
 * GraviPlateAccession with nested sections, returned by `graviPlateAccessions.list()`.
 */
export interface GraviPlateAccessionWithSections {
  id: string;
  plate_id: string;
  accession: string;
  transplant_date: Date | null;
  custom_note: string | null;
  sections: GraviPlateSectionData[];
}
