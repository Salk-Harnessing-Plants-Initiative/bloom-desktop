## 1. Coordinator correctness fixes

- [x] 1.1 Write failing tests for `ScanCoordinator.getScannerStatuses()`
      (`tests/unit/scan-coordinator-add-scanner.test.ts`): empty, all-ready,
      error-only (from `initErrors`, scanner removed from subprocess map),
      mixed ready+error, and a live-subprocess entry taking precedence over a
      stale `initErrors` entry for the same id
- [x] 1.2 Implement `getScannerStatuses()` on `ScanCoordinator`
      (`src/main/graviscan/scan-coordinator.ts`)
- [x] 1.3 Write a failing test proving `initialize()` keeps a stale
      `initErrors` entry across a later successful init for the same scanner
- [x] 1.4 Add `this.initErrors.clear()` at the top of `initialize()`
- [x] 1.5 Write a failing test proving the pre-fix `addScanner()` mid-scan
      queue creates two subprocesses (with a premature shutdown of the
      first) when called twice for the same `scannerId` while a cycle is
      in flight — confirm RED against the current code before fixing
- [x] 1.6 ~~Restore the re-entrant `addScanner()` call inside the queued
      `cycle-complete` handler~~ — superseded by 1.8/1.9: re-entering
      `addScanner()` fixes the double-spawn but livelocks (its own
      `isScanning` check is still true at that instant, so it re-queues
      forever and never spawns)
- [x] 1.8 Write failing tests proving the re-entrant queue never spawns:
      a single mid-scan `addScanner()` call must resolve and make
      `hasWorker()` true after the next `cycle-complete`; two concurrent
      mid-scan calls for the same id must yield exactly **1** construction
      (not 0, not 2), 0 premature shutdowns, and both promises resolved —
      confirm RED (all time out) against the re-entrant code
- [x] 1.9 Replace the re-entrant call with a per-scanner `pendingAdds`
      promise map: concurrent mid-scan calls for the same `scannerId`
      share one queued spawn, whose handler calls `spawnSingleScanner()`
      directly and clears the map entry when it settles — confirm the 1.8
      tests go GREEN
- [x] 1.7 Add `getScannerStatuses()` to the `ScanCoordinatorLike` interface
      (`src/main/graviscan/session-handlers.ts`)

## 2. `graviscan:get-scanner-status`

- [x] 2.1 Write failing tests for `scannerHandlers.getScannerStatus()`
      (`tests/unit/graviscan/get-scanner-status-handler.test.ts`): merges
      live status onto saved rows, reports `disconnected` for unmatched
      rows, null-coordinator defaults to all-disconnected,
      `display_name`/`name` fallback, error passthrough, DB-throw handling,
      `orderBy: createdAt asc`
- [x] 2.2 Write failing tests for the `gridMode` deviation: sourced from the
      `GraviConfig` singleton and applied to every scanner in the response;
      defaults to `'2grid'` when no `GraviConfig` row exists; only one
      `GraviConfig` query regardless of scanner count
- [x] 2.3 Implement `getScannerStatus(coordinator, db)` in
      `src/main/graviscan/scanner-handlers.ts`
- [x] 2.4 Register `graviscan:get-scanner-status` in
      `src/main/graviscan/register-handlers.ts`, delegating directly
      (matches production's `{ success, scanners, error? }` shape, not
      wrapped via the generic `wrapHandler`)

## 3. `graviscan:ensure-dir` and `graviscan:list-scan-files`

- [x] 3.1 Write failing tests for `imageHandlers.ensureDir()`
      (`tests/unit/graviscan/image-handlers.test.ts`): creates recursively,
      idempotent re-call, missing/non-string `dirPath` rejected, mkdir
      rejection surfaced
- [x] 3.2 Implement `ensureDir(dirPath)` in
      `src/main/graviscan/image-handlers.ts`
- [x] 3.3 Write failing tests for `imageHandlers.listScanFiles()`: flat mode
      (given `dirPath`) vs. base-dir recursive mode (no `dirPath`),
      extension filtering, newest-first sort, missing-directory returns
      empty list, `readdirSync` throw surfaced as a failure result
- [x] 3.4 Implement `listScanFiles(dirPath?)` in
      `src/main/graviscan/image-handlers.ts`
- [x] 3.5 Register `graviscan:ensure-dir` and `graviscan:list-scan-files` in
      `register-handlers.ts`, delegating directly (same un-wrapped
      convention as 2.4)
- [x] 3.6 Write failing tests proving both new handlers accept an
      arbitrary caller-supplied path (outside-the-output-dir, `..`
      traversal, and symlink escape) — the containment precedent
      `graviscan:read-scan-image` sets in the same file
- [x] 3.7 Extract `read-scan-image`'s realpath-containment logic into a
      shared helper in `register-handlers.ts` (plus an
      allow-a-missing-tail variant, since `ensure-dir` creates the
      directory and `list-scan-files` reports an empty list for a
      not-yet-created one) and apply it to both new handlers —
      `read-scan-image` now uses the helper too

## 4. IPC registration coverage

- [x] 4.1 Update `register-handlers.test.ts`'s channel count (17 → 20) and
      channel list
- [x] 4.2 Add delegation tests for all 3 new channels (args passed through,
      result shape returned directly)

## 5. Verification

- [x] 5.1 `npx vitest run` — full suite green modulo pre-existing,
      unrelated failures (native `better-sqlite3` binding + two Windows
      path-separator assertions), confirmed identical on `main` via
      `git stash` comparison
- [x] 5.2 `npx tsc --noEmit` — no new errors (one pre-existing error in
      `graviscan-upload.ts`, confirmed identical on `main`)
- [x] 5.3 `npx prettier --check` on all changed files
- [x] 5.4 `openspec validate add-scanner-status-handlers --strict`
