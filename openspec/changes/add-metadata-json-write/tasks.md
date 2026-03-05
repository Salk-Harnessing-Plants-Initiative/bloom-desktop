## Red-Green TDD Phases

### Phase 1: RED — Unit Tests (all tests written FIRST, all should FAIL)

- [x] 1.1 Write unit test: metadata.json content/format (correct fields, correct types, correct JSON structure with 2-space indent)
- [x] 1.2 Write unit test: atomic write (temp file + rename pattern)
- [x] 1.3 Write unit test: write-before-capture timing (metadata written before Python command sent)
- [x] 1.4 Write unit test: directory creation if not exists
- [x] 1.5 Write unit test: graceful failure (write error does not block scanning)
- [x] 1.6 Run tests — verify they all FAIL (RED) — confirmed: module not found error

### Phase 2: GREEN — Implementation

- [x] 2.1 Implement `writeMetadataJson()` in `src/main/metadata-json.ts` (atomic write: temp file + rename)
- [x] 2.2 Hook it in at `scan()` method before `this.pythonProcess.sendCommand()` (scanner-process.ts:97)
- [x] 2.3 Assemble metadata object matching pilot format (all fields from settings + camera + daq)
- [x] 2.4 Run tests — verify they all PASS (GREEN) — 8/8 unit tests pass

### Phase 3: RED — Integration Tests (written FIRST, should FAIL)

- [x] 3.1 Write integration test: ScannerProcess.scan() produces metadata.json in output directory
- [x] 3.2 Write integration test: metadata.json content matches expected format with all fields
- [x] 3.3 Write integration test: scan proceeds even if metadata write fails (graceful degradation)
- [x] 3.4 Write integration test: no metadata.json when no metadata provided

### Phase 4: GREEN — Integration Implementation

- [x] 4.1 All integration tests pass immediately (implementation already in place) — 4/4 pass
- [x] 4.2 All 12 tests pass (8 unit + 4 integration)

### Phase 5: E2E Tests — Deferred

- [ ] 5.1 E2E testing of metadata.json requires full scan execution with mock hardware in Electron context
- [ ] 5.2 Existing E2E scan tests only cover UI inputs, not the scan execution flow
- [ ] 5.3 E2E metadata.json tests should be added when scan E2E infrastructure supports full capture workflow

### Phase 6: Pre-merge

- [x] 6.1 All unit tests pass (`npm run test:unit`) — 337 passed
- [ ] 6.2 Linting passes (`npm run lint`)
- [x] 6.3 TypeScript compiles (`npx tsc --noEmit`) — clean
- [ ] 6.4 Open PR referencing #99
