## Why

GitHub Copilot code review of PR #92 identified 7 additional issues: cross-platform file URL bugs, metadata validation rejecting leading zeros, query performance loading unnecessary image data, stale frame state on scan navigation, silent parseInt coercion, double-fetch on filter changes, and a misleading E2E test name.

## What Changes

- Fix leading zeros rejected by metadata validation (`"01"` produces "must be a whole number")
- Guard parseInt coercion in session persistence with existing validators
- Optimize paginated scan list to select only id+status from images (not full records)
- Reset currentFrame to 0 when navigating between scans
- Fix cross-platform file:// URL construction for Windows paths and spaces
- Eliminate double fetch when BrowseScans filters change
- Rename misleading E2E test to match actual behavior

## Impact

- Affected specs: scanning (metadata validation), scan-preview (file URLs, frame reset)
- Affected code: metadata-validation.ts, CaptureScan.tsx, database-handlers.ts, database.ts, BrowseScans.tsx, ScanPreview.tsx, scan-preview.e2e.ts
- New files: src/utils/file-url.ts, tests/unit/file-url.test.ts, tests/unit/metadata-validation.test.ts
