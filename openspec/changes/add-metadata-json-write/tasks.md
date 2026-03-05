## Red-Green TDD Phases

### Phase 1: RED — Unit Tests (all tests written FIRST, all should FAIL)

- [ ] 1.1 Write unit test: metadata.json content/format (correct fields, correct types, correct JSON structure with 2-space indent)
- [ ] 1.2 Write unit test: atomic write (temp file + rename pattern)
- [ ] 1.3 Write unit test: write-before-capture timing (metadata written before Python command sent)
- [ ] 1.4 Write unit test: directory creation if not exists
- [ ] 1.5 Write unit test: graceful failure (write error does not block scanning)
- [ ] 1.6 Run tests — verify they all FAIL (RED)

### Phase 2: GREEN — Implementation

- [ ] 2.1 Implement `writeMetadataJson()` in `scanner-process.ts` (atomic write: temp file + rename)
- [ ] 2.2 Hook it in at `scan()` method before `this.pythonProcess.sendCommand()` (line 97)
- [ ] 2.3 Assemble metadata object matching pilot format (all fields from settings + camera + daq)
- [ ] 2.4 Run tests — verify they all PASS (GREEN)

### Phase 3: RED — Integration Tests (written FIRST, should FAIL)

- [ ] 3.1 Write integration test: full scan flow produces metadata.json in output directory
- [ ] 3.2 Write integration test: metadata.json content matches database Scan record
- [ ] 3.3 Run tests — verify they FAIL (RED)

### Phase 4: GREEN — Integration Implementation

- [ ] 4.1 Wire up any missing pieces for integration tests to pass
- [ ] 4.2 Run tests — verify they PASS (GREEN)

### Phase 5: RED — E2E Tests with Playwright (written FIRST, should FAIL)

- [ ] 5.1 Write Playwright E2E test that captures a scan and verifies metadata.json exists on disk
- [ ] 5.2 Write Playwright E2E test that verifies metadata.json content
- [ ] 5.3 Run tests — verify they FAIL (RED)

### Phase 6: GREEN — E2E fixes

- [ ] 6.1 Fix any issues found by E2E tests
- [ ] 6.2 Run tests — verify they PASS (GREEN)

### Phase 7: Pre-merge

- [ ] 7.1 All unit tests pass (`npm run test:unit`)
- [ ] 7.2 All integration tests pass (`npm run test:scanner`)
- [ ] 7.3 E2E tests pass (`npm run test:e2e`)
- [ ] 7.4 Linting passes (`npm run lint`)
- [ ] 7.5 TypeScript compiles (`npx tsc --noEmit`)
- [ ] 7.6 Open PR referencing #99
