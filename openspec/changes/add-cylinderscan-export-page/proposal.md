## Why

CylinderScan operators have no way to move a batch of completed scans off the capture machine to shared/network storage for downstream analysis. The retired pilot app (`bloom-desktop-pilot`) had an Export page, but it was never rebuilt in the current `bloom-desktop`, and its behavior (silent overwrite, no error handling, dead progress code) is not something we want to carry forward unchanged.

## What Changes

- Add a new "Export Scans" page (route `export`, matching #77's specified path; nav link in `Layout.tsx`) listing all non-deleted scans across every scanner — **deliberately not scoped to the current scanner, deviating from #77's stated acceptance criterion; see "Deviation from #77" below** — grouped by experiment × capture day, with a per-group scan count, a live selected-scan count, and the export action disabled until a destination and at least one scan are selected.
- Each scan has its own checkbox; each experiment×day group has a tri-state header checkbox (new UI, built via a ref — no existing indeterminate-checkbox precedent in this codebase to reuse) that selects/deselects every scan in that group. One unified list, no separate view-mode toggle.
- User picks a destination directory via the existing `config:browse-directory` native picker (already generic — no changes needed there).
- Add a new `db:scans:export` IPC handler in `database-handlers.ts` that:
  - Looks up the selected scans with an explicit `deleted: false` filter (a dedicated query, not the legacy branch of `db:scans:list`, which is missing that filter).
  - Resolves and containment-checks each scan's source path (against the configured `scans_dir`) and destination path (against the chosen destination directory) using the same boundary-aware check already shipped for the `bloom-scan://` protocol handler (`resolveScanPath`, `src/main/scan-protocol.ts`), rejecting (and recording as failed, not silently skipping) any scan whose path would escape either boundary.
  - Copies each file to a `.tmp` sibling and renames it into place only once complete — the same atomic-write pattern already used for `metadata.json` itself, applied per file (not per whole scan folder, which would break re-exporting into a destination that already has some of a scan's files) — with metadata copied before that scan's image frames, so a crash never leaves a truncated file or a scan with frames but no metadata.
  - Skips any file that already exists at the final destination and counts the skips, instead of overwriting; tracks copied, skipped, and failed scans as three distinct counters (with enough detail per failed scan — experiment, full capture timestamp — to identify and re-attempt it) rather than aborting the whole batch on one bad scan.
  - Reports live progress via `webContents.send('db:scans:export-progress', ...)`, following GraviScan's existing `downloadImages` / `graviscan:download-images` concurrency + progress-callback pattern.
- Expose `database.scans.export(scanIds, destinationDir)` and `database.scans.onExportProgress(callback)` (with listener cleanup, verified against unmount) from `preload.ts`, mirroring `downloadImages` / `onDownloadProgress`.
- Renderer shows a live progress indicator during export, a persistent warning not to disconnect the destination (e.g. a USB drive) until the export finishes — issue #77 explicitly targets USB/network destinations, and disconnecting mid-write is a realistic failure mode this page should actively warn against, not just document as a risk — and a transient banner reporting exported/skipped/failed counts on completion (failed scans listed by experiment and full capture timestamp, shown distinctly from skipped), or a transient error banner on a fatal, batch-wide failure.
- Add `db:scans:export` coverage to `tests/e2e/renderer-database-ipc.e2e.ts` — required by the IPC coverage gate (`scripts/check-ipc-coverage.py`), which statically scans that file for the handler name or a `.scans.export(` call.

## Impact

- Affected specs: `scan-export` (new capability)
- Affected code: `src/renderer/Export.tsx` (new), `src/renderer/Layout.tsx` (nav link), `src/renderer/App.tsx` (route), `src/main/database-handlers.ts` (new handler), `src/main/preload.ts` (new API surface), `src/types/database.ts` (`DatabaseAPI` type additions), `tests/e2e/renderer-database-ipc.e2e.ts` (new coverage)

## Deviation from #77

Issue #77's acceptance criteria say the page should "only show scans from current scanner device" (matching the pilot's `scanner:get-scanner-id` scoping). This proposal deliberately does **not** scope by scanner — see `design.md`'s "Decisions" section for the full rationale (confirmed with the user on 2026-08-05). After merge, #77 should get a comment noting this deviation so a future reader doesn't mistake that unchecked acceptance criterion for a forgotten one. Every other acceptance criterion in #77 — including "shows count of selected scans" and "export button disabled until directory and scans selected," which an earlier draft of this proposal missed — is now addressed.
