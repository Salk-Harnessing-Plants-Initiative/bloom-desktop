## 1. Tests First (TDD)

- [ ] 1.1 Write unit test: metadata.json content matches expected format (all fields present, correct types, 2-space indent)
- [ ] 1.2 Write unit test: atomic file write (writes to temp file, renames to metadata.json)
- [ ] 1.3 Write unit test: metadata.json is written before scan command is sent to Python
- [ ] 1.4 Write unit test: output directory is created if it doesn't exist
- [ ] 1.5 Write unit test: metadata.json write failure does not prevent scan from proceeding (graceful degradation)

## 2. Implementation

- [ ] 2.1 Add `writeMetadataJson()` helper to `scanner-process.ts` (atomic write: temp file + rename)
- [ ] 2.2 Call `writeMetadataJson()` in `scan()` method before `this.pythonProcess.sendCommand()` (before line 98)
- [ ] 2.3 Assemble metadata object matching pilot format (all fields from settings + camera + daq)

## 3. Integration Testing

- [ ] 3.1 Write integration test: full scan flow produces metadata.json in output directory
- [ ] 3.2 Write integration test: metadata.json content matches database Scan record
- [ ] 3.3 Verify metadata.json is present before first image file appears

## 4. Pre-merge Checks

- [ ] 4.1 All unit tests pass (`npm run test:unit`)
- [ ] 4.2 All integration tests pass (`npm run test:scanner`)
- [ ] 4.3 Linting passes (`npm run lint`)
- [ ] 4.4 TypeScript compiles (`npx tsc --noEmit`)
