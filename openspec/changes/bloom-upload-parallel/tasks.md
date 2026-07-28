## 1. Upload orchestration module

- [ ] 1.1 Port `createAuthenticatedClients()`, `processImageJobs()` (parallel, 4-worker), `uploadSessions()`, `uploadMetadata()`, `uploadAllPendingScans()` from stranded-branch commit `84b54e6`'s `src/main/graviscan-upload.ts`
- [ ] 1.2 Adapt credential loading to `loadEnvConfig()` (matching `image-uploader.ts`), not a hand-rolled `.env` parser
- [ ] 1.3 Adapt `@supabase/supabase-js`/`@salk-hpi/bloom-js` imports to dynamic imports (matching `image-uploader.ts`)

## 2. Types

- [ ] 2.1 Create `src/types/graviscan-store.ts`, trimmed to only the `SupabaseStore` extension methods still missing from the installed `@salk-hpi/bloom-js` version's own types

## 3. Wiring

- [ ] 3.1 `src/main/graviscan/image-handlers.ts`'s `uploadAllScans()` runs Bloom (via the new module) and Box in parallel via `Promise.allSettled`, merging results

## 4. Tests

- [ ] 4.1 Unit tests for the upload orchestration module (mocked Supabase client) — none existed on the source branch
- [ ] 4.2 Updated/new tests for `uploadAllScans()`'s parallel Bloom+Box behavior
