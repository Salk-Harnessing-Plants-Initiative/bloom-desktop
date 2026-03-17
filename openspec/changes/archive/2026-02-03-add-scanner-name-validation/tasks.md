# Tasks: Add Scanner Name Validation via Bloom API

## Phase 1: API Integration (TDD)

### 1.1 Types and IPC Interface

- [x] 1.1.1 Add `Scanner` type to `src/types/electron.d.ts`
- [x] 1.1.2 Add `config.fetchScanners()` method to `ConfigAPI` interface
- [x] 1.1.3 Expose `fetchScanners` in preload.ts

### 1.2 Bloom API Handler (TDD)

- [x] 1.2.1 Write unit tests for `fetchScannersFromBloom()` function
  - Test successful fetch returns scanner list
  - Test API error throws appropriate error
  - Test network timeout handling
  - Test malformed response handling
- [x] 1.2.2 Implement `fetchScannersFromBloom()` in config-store.ts or new bloom-api.ts
- [x] 1.2.3 Add IPC handler `config:fetch-scanners` in main.ts
- [x] 1.2.4 Write integration test for IPC handler

## Phase 2: UI Changes (TDD)

### 2.1 MachineConfiguration Component Updates

- [x] 2.1.1 Write unit tests for scanner dropdown behavior
  - Test loading state shown while fetching
  - Test error state when fetch fails
  - Test dropdown populated with scanner list
  - Test scanner selection updates config
  - Test existing scanner name pre-selected
- [x] 2.1.2 Add state for scanner list, loading, and error
- [x] 2.1.3 Fetch scanners on component mount (when credentials exist)
- [x] 2.1.4 Replace text input with dropdown selector
- [x] 2.1.5 Add loading spinner during fetch
- [x] 2.1.6 Add error message with retry button when fetch fails

### 2.2 First-Run Flow

- [x] 2.2.1 Write tests for first-run flow
  - Test credentials form shown first
  - Test scanner fetch triggered after credentials saved
- [x] 2.2.2 Update first-run flow to fetch scanners after credentials are entered

## Phase 3: Validation Updates

### 3.1 Config Validation

- [x] 3.1.1 Write unit tests for updated validation
  - Test empty scanner name rejected
  - Test validation passes for any non-empty name (API handles validity)
- [x] 3.1.2 Update `validateConfig()` to remove alphanumeric restriction (dropdown enforces validity)

## Phase 4: E2E Testing

### 4.1 End-to-End Tests

- [x] 4.1.1 Write E2E test: scanner dropdown shows available scanners
- [x] 4.1.2 Write E2E test: selecting scanner updates config
- [x] 4.1.3 Write E2E test: error shown when API unavailable

## Definition of Done

- [x] All unit tests pass
- [x] All integration tests pass
- [x] E2E tests pass
- [x] Lint passes
- [x] TypeScript compiles without errors
- [x] Scanner dropdown fetches from Bloom API
- [x] Users cannot enter arbitrary scanner names

---

## Implementation Notes

This proposal has been fully implemented:

1. **Scanner interface**: Defined in `config-store.ts` with `id: number` and `name: string | null`
2. **fetchScannersFromBloom()**: Uses Supabase auth and `SupabaseStore.getAllCylScanners()`
3. **Scanner dropdown**: `MachineConfiguration.tsx` has dropdown with loading/error states
4. **Tests**: 55 config-store tests including fetchScanners tests, 24 MachineConfiguration tests

Verified by code inspection:

- `Scanner` interface at line 77-82 in config-store.ts
- `fetchScannersFromBloom()` at line 530-586 in config-store.ts
- Scanner dropdown in MachineConfiguration.tsx with `scannerList`, `scannerListLoading`, `scannerListError` state
