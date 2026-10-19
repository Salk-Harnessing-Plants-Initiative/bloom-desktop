/**
 * Type definitions for GraviScan external store interfaces.
 *
 * Desktop's own types for the GraviScan session and plate-metadata methods on
 * bloom-js's SupabaseStore. They were written when @salk-hpi/bloom-js@0.2.1
 * lacked `insertGraviScanSession` and `insertGraviScanMetadata`. bloom-js 0.4.0
 * has both and exports its own `GraviScanSessionParams` /
 * `GraviScanMetadataParams`; switching to those is a follow-up.
 * `src/main/graviscan-upload.ts` still checks the methods exist before calling them.
 */

import type { SupabaseStore } from '@salk-harnessing-plants-initiative/bloom-js';
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
 * Common return type for Supabase store insert operations.
 */
export interface StoreResult<T = number> {
  created: T;
  error: PostgrestError | null;
}

/**
 * The GraviScan session and plate-metadata methods on SupabaseStore, typed
 * with Desktop's own params (bloom-js 0.4.0 declares them too).
 *
 * Usage: cast `store` to this interface instead of `any`, and check the
 * method exists before calling:
 *   const ext = store as GraviScanStoreExtensions;
 *   if (typeof ext.insertGraviScanSession === 'function') { ... }
 */
export interface GraviScanStoreExtensions extends SupabaseStore {
  insertGraviScanSession(params: GraviScanSessionParams): Promise<StoreResult>;

  insertGraviScanMetadata(
    params: GraviScanMetadataParams
  ): Promise<StoreResult>;
}
