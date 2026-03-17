## Why

The `metadata.json` feature (PR #115) works correctly but has several hardening gaps identified in code review:

1. **No schema version** — future schema changes have no way to distinguish v1 from v2 files
2. **Missing trailing newline** — JSON output lacks POSIX-standard trailing newline, causing noisy diffs in editors
3. **Undocumented `num_frames` fallback** — `settings.num_frames ?? settings.daq.num_frames` silently prefers top-level, which could mask config bugs
4. **Ambiguous `scan_path` type** — consumers don't know if they're getting a relative or absolute path
5. **Stale `.tmp` on crash** — if process crashes between writeFileSync and renameSync, `.tmp` persists silently
6. **Test portability** — integration test uses `/dev/null/impossible/path` which has platform-specific behavior
7. **Wrong contrast default** — `contrast ?? 1` but Basler Pylon API identity value is 0 (range -1.0 to 1.0), and the pilot defaults to 0. A value of 1 implies maximum contrast boost. See: Basler docs, bloom-desktop-pilot defaults, issue #95.

## What Changes

- Add `metadata_version: 1` field to `ScanMetadataJson` interface and `buildMetadataObject`
- Append `\n` to JSON output in `writeMetadataJson`
- Add inline comment documenting `num_frames` fallback preference
- Document `scan_path` field semantics (relative preferred, absolute fallback) in interface JSDoc
- Clean up stale `.tmp` file before atomic write
- Replace `/dev/null/impossible/path` with a cross-platform test approach
- **Fix contrast default from 1 to 0** in both `scan-metadata-json.ts` and `scanner-process.ts`, matching Basler API identity value and pilot defaults
- Add comments documenting camera defaults rationale with pilot reference

## Impact

- Affected specs: scanning
- Affected code: `src/main/scan-metadata-json.ts`, `src/main/scanner-process.ts`, `tests/unit/scan-metadata-json.test.ts`, `tests/unit/scanner-metadata-integration.test.ts`
- **Bug fix**: contrast default was 1 (max boost in Basler API) instead of 0 (identity/no adjustment)
- No other breaking changes — `metadata_version` is additive, trailing newline is backward-compatible
