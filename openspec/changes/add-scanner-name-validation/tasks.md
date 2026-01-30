# Tasks: Add Scanner Name Validation via Bloom API

## Phase 1: API Integration (TDD)

### 1.1 Types and IPC Interface

- [ ] 1.1.1 Add `Scanner` type to `src/types/electron.d.ts`
- [ ] 1.1.2 Add `config.fetchScanners()` method to `ConfigAPI` interface
- [ ] 1.1.3 Expose `fetchScanners` in preload.ts

### 1.2 Bloom API Handler (TDD)

- [ ] 1.2.1 Write unit tests for `fetchScannersFromBloom()` function
  - Test successful fetch returns scanner list
  - Test API error throws appropriate error
  - Test network timeout handling
  - Test malformed response handling
- [ ] 1.2.2 Implement `fetchScannersFromBloom()` in config-store.ts or new bloom-api.ts
- [ ] 1.2.3 Add IPC handler `config:fetch-scanners` in main.ts
- [ ] 1.2.4 Write integration test for IPC handler

## Phase 2: UI Changes (TDD)

### 2.1 MachineConfiguration Component Updates

- [ ] 2.1.1 Write unit tests for scanner dropdown behavior
  - Test loading state shown while fetching
  - Test error state when fetch fails
  - Test dropdown populated with scanner list
  - Test scanner selection updates config
  - Test existing scanner name pre-selected
- [ ] 2.1.2 Add state for scanner list, loading, and error
- [ ] 2.1.3 Fetch scanners on component mount (when credentials exist)
- [ ] 2.1.4 Replace text input with dropdown selector
- [ ] 2.1.5 Add loading spinner during fetch
- [ ] 2.1.6 Add error message with retry button when fetch fails

### 2.2 First-Run Flow

- [ ] 2.2.1 Write tests for first-run flow
  - Test credentials form shown first
  - Test scanner fetch triggered after credentials saved
- [ ] 2.2.2 Update first-run flow to fetch scanners after credentials are entered

## Phase 3: Validation Updates

### 3.1 Config Validation

- [ ] 3.1.1 Write unit tests for updated validation
  - Test empty scanner name rejected
  - Test validation passes for any non-empty name (API handles validity)
- [ ] 3.1.2 Update `validateConfig()` to remove alphanumeric restriction (dropdown enforces validity)

## Phase 4: E2E Testing

### 4.1 End-to-End Tests

- [ ] 4.1.1 Write E2E test: scanner dropdown shows available scanners
- [ ] 4.1.2 Write E2E test: selecting scanner updates config
- [ ] 4.1.3 Write E2E test: error shown when API unavailable

## Definition of Done

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] E2E tests pass
- [ ] Lint passes
- [ ] TypeScript compiles without errors
- [ ] Scanner dropdown fetches from Bloom API
- [ ] Users cannot enter arbitrary scanner names
