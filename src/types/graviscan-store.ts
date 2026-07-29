/**
 * Type definitions for GraviScan external store interfaces.
 *
 * These types cover methods on @salk-hpi/bloom-js's SupabaseStore that are
 * GraviScan-specific and not yet exported from the package's own type
 * definitions. Once the package adds proper exports, this file can be
 * trimmed further (or removed).
 *
 * NOTE (verified against installed @salk-hpi/bloom-js@0.2.1, 2026-07-28):
 * `insertGraviImageMetadata` and `updateGraviImageMetadata` are ALREADY
 * natively typed (and implemented) on `SupabaseStore` — see
 * node_modules/@salk-hpi/bloom-js/dist/{types,core/supabase}/data-store.d.ts.
 * They are intentionally NOT redeclared here to avoid conflicting with the
 * package's own types. `insertGraviScanSession` and `insertGraviScanMetadata`
 * remain genuinely missing (no method, and no corresponding Supabase RPC/table
 * in the installed package's generated `database.types.d.ts` — the
 * `gravi_scan_sessions` table exists but nothing wraps it, and there is no
 * plate/accession-metadata table or RPC at all yet). Callers in
 * `src/main/graviscan-upload.ts` feature-detect these methods at runtime and
 * skip session/metadata upload gracefully when absent, so this file only
 * needs to supply the types for when the package catches up.
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
 * Common return type for Supabase store insert operations.
 */
export interface StoreResult<T = number> {
  created: T;
  error: PostgrestError | null;
}

/**
 * GraviScan-specific methods on SupabaseStore that are not yet part of the
 * installed @salk-hpi/bloom-js package's own types/implementation.
 *
 * Usage: cast `store` to this interface instead of `any`, and feature-detect
 * before calling since the package may not implement these yet:
 *   const ext = store as GraviScanStoreExtensions;
 *   if (typeof ext.insertGraviScanSession === 'function') { ... }
 */
export interface GraviScanStoreExtensions extends SupabaseStore {
  insertGraviScanSession(params: GraviScanSessionParams): Promise<StoreResult>;

  insertGraviScanMetadata(
    params: GraviScanMetadataParams
  ): Promise<StoreResult>;
}
