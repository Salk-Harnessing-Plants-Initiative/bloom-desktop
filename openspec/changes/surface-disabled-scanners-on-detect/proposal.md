## Why

After PR #196 (`fix-scanner-config-save-flow`) the user can disable a scanner by unchecking it on the Scanner Configuration page. The save flow correctly propagates that to `GraviScanner.enabled = false`. However, on the next visit to the page, **`detectScanners` filters its DB query by `enabled: true`** — so the disabled scanner disappears from the page entirely. The user has no UI path to re-enable it. This is a Catch-22: to re-enable a scanner, the user must see its checkbox; to see its checkbox, the scanner must be enabled.

Smoke testing of PR #196 surfaced this immediately: a user disables Scanner 2, saves, comes back, and the page now shows only Scanner 1 with no way to recover.

## What Changes

### Bug fix — surface disabled DB scanners on detection

- **`detectScanners` queries all `GraviScanner` rows**, not just `enabled: true`. Disabled rows are part of "what the user has configured before" and should be visible on the Scanner Configuration page (rendered as an unchecked checkbox), so the user can re-enable them.
- **`DetectedScanner` gains an optional `enabled?: boolean` field.** Populated in mock mode from the DB row's `enabled`. In real mode, populated by `matchDetectedToDb` when the detected scanner matches a DB row; absent (treated as `true`) for newly-discovered physical scanners not yet in the DB.
- **Renderer `buildAssignmentsFromDetection`** treats `enabled === false` as an additional reason to render the scanner as unchecked. This is in addition to the existing `localStorage.uncheckedScannerKeys` check. The two sources of truth are reconciled: a scanner is "checked" iff (DB row says enabled OR no DB row exists yet) AND (no localStorage unchecked entry).

### Downstream consumers stay correct

- `disableMissingScanners` continues to flip `enabled = false` on rows omitted from the renderer's enabled-identity list — unchanged.
- `validateConfig` continues to query `enabled: true` (its semantic is "scanners I expect to be operational right now," distinct from "scanners the user has ever configured"). Unchanged.
- `runStartupScannerValidation` continues to query `enabled: true` for the same reason. Unchanged.
- `buildMockScanners` continues to return one entry per DB row (no padding when DB has rows). Now includes disabled rows.

### Tests

- New unit tests for `detectScanners` mock-mode behavior with disabled rows present
- New unit test for `buildAssignmentsFromDetection` rendering a disabled-DB scanner as unchecked
- Manual smoke verification that the user can re-enable a disabled scanner

## Impact

- Affected specs: `scanning` (MODIFIED `GraviScan Scanner Detection and Configuration` requirement and `GraviScan Scanner Configuration Page` requirement)
- Affected code:
  - MODIFIED: `src/types/graviscan.ts` (add `enabled?: boolean` to `DetectedScanner`)
  - MODIFIED: `src/main/graviscan/scanner-handlers.ts` (`detectScanners` queries all rows; `buildMockScanners` and `matchDetectedToDb` propagate `enabled`)
  - MODIFIED: `src/renderer/hooks/useScannerConfig.ts` (`buildAssignmentsFromDetection` treats `enabled === false` as unchecked)
  - MODIFIED: `tests/unit/graviscan/scanner-handlers.test.ts` (test disabled rows surface in detection)
  - MODIFIED: `tests/unit/hooks/useScannerConfig.test.ts` (test renderer-side handling of `enabled === false`)
- Surfaced during: smoke test of PR #196

## Non-Goals

- Auto-cleanup of stale DB rows (tracked in #167)
- Visual differentiation between "currently enabled" vs "previously enabled but unchecked" beyond the checkbox state itself (no badges, banners, etc.)
- Adding admin UI to permanently delete a scanner row (a checkbox toggle is sufficient for now; permanent delete is filed under #167)
