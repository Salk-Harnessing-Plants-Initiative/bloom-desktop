## Why

`retryScanner()` reports `{ success: true }` as soon as `coordinator.addScanner(...)` resolves, but `addScanner()`/`spawnSingleScanner()` never throw on spawn failure — a respawned worker can silently stay dead while the operator is told it recovered, risking undetected, unattended data loss for the rest of a multi-day run (issue #283; same failure class as #244).

This was an explicit "accepted limitation" in the original wedge-response-ui proposal (`design.md` Decision 7, archived 2026-08-04), re-flagged as more severe by two independent reviewers during PR #277's post-implementation review — see `design.md`'s Context section here for the full history.

## What Changes

- `retryScanner()` checks `coordinator.getScannerStatuses()` for the retried `scannerId` immediately after `addScanner()` resolves, and returns `{ success: false, error }` if the scanner isn't reported `'ready'` — mirroring the existing `hasWorker()` check `startScan()` already runs after `initialize()`.
- The new failure path writes a `scanLog()` entry, matching the existing "rejected respawn is caught and surfaced" scenario's logging requirement — this is the same failure severity and operator-visibility need, just detected via a status check instead of a thrown exception. All three `retryScanner()` log lines (success, caught-rejection failure, new status-check failure) also gain `session_id`, for cross-session log correlation. (An earlier draft also added `cycle_number` by analogy with `WedgeDetector`'s auto-pause log line — dropped during post-implementation review once it turned out `ScanSessionState.currentCycle` is dead data, always `0`; see `design.md` Decision 2.)
- Test-only: the local mock `ScanCoordinatorLike` interface and `createMockCoordinator()` in `tests/unit/graviscan/session-handlers.test.ts` gain a `getScannerStatuses` member (mirroring the real interface in `session-handlers.ts`, which already declares it), defaulting to a `'ready'` status for whichever `scannerId` is queried, so existing happy-path tests keep passing.

No renderer changes: `WedgeBanner.tsx` already handles `{ success: false, error }` correctly.

## Impact

- Affected specs: `scanning` — MODIFIED "GraviScan Retry-Scanner Action" requirement (full text carried forward per OpenSpec convention; one existing scenario updated, one new scenario added for the silent-failure case)
- Affected code: `src/main/graviscan/session-handlers.ts` (`retryScanner()`), `tests/unit/graviscan/session-handlers.test.ts`
- Out of scope: issue #279 (manual rig verification — note its "click Retry without power-cycling" checklist item's expected behavior changes post-fix, worth a follow-up comment on that issue but not part of this change), issue #281 (three other pre-existing coordinator/subprocess risks — separate, larger scope), issue #243 (coordinator/DB scannerId join-key divergence — this fix relies on the same `scannerId` join `retryScanner()` already used pre-fix, doesn't newly introduce that trust assumption), the GraviScan renderer roadmap doc (Tier 3 stays marked merged; this is a bug fix on already-shipped Tier 3 code, not a new tier)
- Known, disclosed limitation (not introduced by this fix — see `design.md` Risks): on the mid-cycle queued respawn path, which is the path an operator's retry click almost always takes during an active session, `retryScanner()`'s promise doesn't resolve until the next `cycle-complete` event, which can be up to a full scan interval. This fix makes the eventual answer accurate; it doesn't make it faster.
