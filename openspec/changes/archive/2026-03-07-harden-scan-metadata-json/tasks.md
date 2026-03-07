## 1. Tests First (TDD Red Phase)

- [x] 1.1 Add test: `buildMetadataObject` includes `metadata_version: 1` in output
- [x] 1.2 Add test: `writeMetadataJson` output ends with trailing newline `\n`
- [x] 1.3 Add test: `buildMetadataObject` uses top-level `num_frames` over `daq.num_frames` when both differ
- [x] 1.4 Add test: `scan_path` field documents relative vs absolute semantics (existing tests cover; added JSDoc)
- [x] 1.5 Add test: stale `.tmp` file is cleaned up before new write
- [x] 1.6 Replace `/dev/null/impossible/path` in integration test with cross-platform mock using `vi.spyOn`

## 2. Implementation (TDD Green Phase)

- [x] 2.1 Add `metadata_version` field to `ScanMetadataJson` interface
- [x] 2.2 Set `metadata_version: 1` in `buildMetadataObject`
- [x] 2.3 Append `\n` to JSON output in `writeMetadataJson`
- [x] 2.4 Add comment documenting `num_frames` fallback logic
- [x] 2.5 Add JSDoc to `scan_path` field explaining relative/absolute semantics
- [x] 2.6 Add `.tmp` cleanup before atomic write in `writeMetadataJson`
- [x] 2.7 Fix integration test to use module mock instead of platform-specific path

## 3. Verification

- [x] 3.1 All unit tests pass (28/28)
- [x] 3.2 All integration tests pass (2/2)
- [x] 3.3 TypeScript compiles with no errors
- [x] 3.4 Prettier formatting passes
- [x] 3.5 ESLint passes on changed files
