# Tasks: Add Supabase Authentication for Scanner Fetch

## Prerequisites

**NPM Token Required**: To access `@salk-hpi/bloom-js` package:

- Token has been added to `.env` file (not committed to git)
- `.env` is in `.gitignore` to prevent accidental commit

## Implementation Checklist

### Phase 1: Package Installation

- [x] Verify NPM_TOKEN is set in .env (already done)
- [x] Install `@supabase/supabase-js` package
- [x] Install `@salk-hpi/bloom-js` package
- [x] Verify packages installed correctly
- [x] Check TypeScript compilation

### Phase 2: Update Types (TDD)

- [x] Update `Scanner` interface in config-store.ts to match `cyl_scanners` schema
  - `id: number`
  - `name: string | null`
- [x] Update `FetchScannersResult` to use new Scanner type
- [x] Run TypeScript compiler to check for type errors

### Phase 3: Test Updates (TDD)

- [x] Read existing `fetchScannersFromBloom` tests
- [x] Update test mocks to use Supabase client API:
  - Mock `createClient()`
  - Mock `supabase.auth.signInWithPassword()`
  - Mock `SupabaseStore.getAllCylScanners()`
- [x] Add test for authentication failure
- [x] Add test for query failure
- [x] Run tests - expect failures (implementation not done yet)

### Phase 4: Implementation

- [x] Import Supabase client and SupabaseStore in config-store.ts
- [x] Rewrite `fetchScannersFromBloom()` to use Supabase authentication:
  - Create Supabase client with apiUrl and anon key
  - Sign in with email/password
  - Handle auth errors
  - Create SupabaseStore instance
  - Call `getAllCylScanners()`
  - Handle query errors
  - Return formatted result
- [x] Run unit tests - expect all to pass
- [x] Run TypeScript compiler - expect no errors

### Phase 5: Integration Testing

- [x] Create test script using credentials from .env
- [x] Verify authentication succeeds
- [x] Verify scanner list fetches from `cyl_scanners` table
- [x] Verify response format matches expected Scanner[]

### Phase 6: UX Fix - Fetch After Save

- [x] Update `handleSave()` in MachineConfiguration.tsx
- [x] Check if credentials changed (compare with stored)
- [x] If credentials changed and save successful, call `fetchScanners()`
- [x] Add loading state during fetch
- [x] Update tests to verify fetch triggered after credential change

### Phase 7: Full Test Suite

- [x] Run all unit tests
- [x] Run all integration tests
- [x] Manual test: First-run flow (no credentials)
- [x] Manual test: Update credentials flow
- [x] Manual test: Scanner dropdown populates after save

---

## Implementation Notes

This proposal has been fully implemented:

1. **Packages installed**: `@supabase/supabase-js` and `@salk-hpi/bloom-js` in package.json
2. **Supabase auth**: `createClient()` and `signInWithPassword()` in `fetchScannersFromBloom()`
3. **Scanner query**: `SupabaseStore.getAllCylScanners()` used to fetch scanner list
4. **Error handling**: Auth errors and query errors handled with clear messages

Verified by code inspection at config-store.ts lines 530-586:

```typescript
const { createClient } = await import('@supabase/supabase-js');
const { SupabaseStore } = await import('@salk-hpi/bloom-js');
const supabase = createClient(apiUrl, credentials.bloom_anon_key);
const { error: authError } = await supabase.auth.signInWithPassword({...});
const store = new SupabaseStore(supabase);
const { data, error } = await store.getAllCylScanners();
```
