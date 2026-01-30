# Tasks: Add Supabase Authentication for Scanner Fetch

## Prerequisites

**NPM Token Required**: To access `@salk-hpi/bloom-js` package:

- Token has been added to `.env` file (not committed to git)
- `.env` is in `.gitignore` to prevent accidental commit

## Implementation Checklist

### Phase 1: Package Installation

- [ ] Verify NPM_TOKEN is set in .env (already done)
- [ ] Install `@supabase/supabase-js` package
- [ ] Install `@salk-hpi/bloom-js` package
- [ ] Verify packages installed correctly
- [ ] Check TypeScript compilation

### Phase 2: Update Types (TDD)

- [ ] Update `Scanner` interface in config-store.ts to match `cyl_scanners` schema
  - `id: number`
  - `name: string | null`
- [ ] Update `FetchScannersResult` to use new Scanner type
- [ ] Run TypeScript compiler to check for type errors

### Phase 3: Test Updates (TDD)

- [ ] Read existing `fetchScannersFromBloom` tests
- [ ] Update test mocks to use Supabase client API:
  - Mock `createClient()`
  - Mock `supabase.auth.signInWithPassword()`
  - Mock `SupabaseStore.getAllCylScanners()`
- [ ] Add test for authentication failure
- [ ] Add test for query failure
- [ ] Run tests - expect failures (implementation not done yet)

### Phase 4: Implementation

- [ ] Import Supabase client and SupabaseStore in config-store.ts
- [ ] Rewrite `fetchScannersFromBloom()` to use Supabase authentication:
  - Create Supabase client with apiUrl and anon key
  - Sign in with email/password
  - Handle auth errors
  - Create SupabaseStore instance
  - Call `getAllCylScanners()`
  - Handle query errors
  - Return formatted result
- [ ] Run unit tests - expect all to pass
- [ ] Run TypeScript compiler - expect no errors

### Phase 5: Integration Testing

- [ ] Create test script using credentials from .env
- [ ] Verify authentication succeeds
- [ ] Verify scanner list fetches from `cyl_scanners` table
- [ ] Verify response format matches expected Scanner[]

### Phase 6: UX Fix - Fetch After Save

- [ ] Update `handleSave()` in MachineConfiguration.tsx
- [ ] Check if credentials changed (compare with stored)
- [ ] If credentials changed and save successful, call `fetchScanners()`
- [ ] Add loading state during fetch
- [ ] Update tests to verify fetch triggered after credential change

### Phase 7: Full Test Suite

- [ ] Run all unit tests
- [ ] Run all integration tests
- [ ] Manual test: First-run flow (no credentials)
- [ ] Manual test: Update credentials flow
- [ ] Manual test: Scanner dropdown populates after save

## Acceptance Criteria

- ✓ `@supabase/supabase-js` and `@salk-hpi/bloom-js` installed
- ✓ Authentication succeeds with test credentials
- ✓ Scanner list fetches from `cyl_scanners` table
- ✓ All 36 config-store tests pass
- ✓ All 20 MachineConfiguration tests pass
- ✓ Scanner dropdown populates after saving credentials
- ✓ Error handling works for auth failures and network errors

## Security Notes

- ⚠️ NPM_TOKEN stored in `.env` (git-ignored)
- ⚠️ Test credentials stored in `.env` (git-ignored)
- ⚠️ Before committing: verify no sensitive data in committed files
- ✓ `.env` is in `.gitignore`

## Technical Notes

### Supabase Client Creation

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(apiUrl, anonKey);
```

### Authentication

```typescript
const { data, error } = await supabase.auth.signInWithPassword({
  email: username,
  password: password,
});
```

### Query Scanners

```typescript
import { SupabaseStore } from '@salk-hpi/bloom-js';

const store = new SupabaseStore(supabase);
const { data, error } = await store.getAllCylScanners();
```

### Scanner Schema (cyl_scanners table)

```typescript
{
  id: number;
  name: string | null;
}
```

## Rollback Plan

If issues arise:

1. Revert config-store.ts changes
2. Revert test changes
3. Uninstall packages (optional)
4. Run test suite to verify rollback

No database or API changes required.
