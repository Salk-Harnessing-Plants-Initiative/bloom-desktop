## Why

GraviScan currently uploads scan images to Box (via `rclone`) only. Bloom (Supabase) upload was fully removed from `main`'s modular structure during the original refactor and never re-ported — it exists only on a stranded branch (`src/main/graviscan-upload.ts`), where it was itself disabled for a period because the `api.bloom.salk.edu` proxy rejected files over 50MB. That size limit has since been confirmed resolved (2026-07-28), so it's safe to bring Bloom upload back as a first-class, parallel-with-Box upload path.

## What Changes

- Port `src/main/graviscan-upload.ts` (session upload → plate-metadata upload → per-image upload to Supabase) from the stranded branch, pinned to source commit `84b54e6` specifically — **not** the branch tip, which has since layered in unrelated, explicitly-deferred wave-scoped-metadata-linking work (a separate track per this project's incremental port plan).
- Per-image upload runs with bounded concurrency (4 workers) instead of one-at-a-time.
- `graviscan:upload-all-scans` runs Bloom and Box uploads in parallel (`Promise.allSettled`) and merges their results, instead of Box-only.
- Adapt to `main`'s established conventions rather than the stranded branch's: dynamic imports for `@supabase/supabase-js`/`@salk-hpi/bloom-js` (matching `image-uploader.ts`'s documented startup-performance rationale), and `loadEnvConfig()` for credentials (matching `image-uploader.ts`) instead of the stranded branch's own hand-rolled `.env` parser.
- New `src/types/graviscan-store.ts` type-extension shim for `SupabaseStore` methods not yet in `@salk-hpi/bloom-js`'s own exported types — trimmed to only what the currently-installed package version (`^0.2.0`) is still missing (some of the stranded branch's shim types have since been upstreamed into the package itself).

### Implementation constraints

- No wave-scoped-metadata-linking logic — that's a separate, deferred track.
- Preserve Box backup behavior exactly; this only adds Bloom alongside it, never replaces it.
- New test coverage is required — the stranded branch shipped this feature with zero tests.

## Impact

- Affected specs: `scanning`
- Affected code:
  - `src/main/graviscan-upload.ts` (new)
  - `src/types/graviscan-store.ts` (new)
  - `src/main/graviscan/image-handlers.ts` — `uploadAllScans()` runs Bloom + Box in parallel
