## 1. Test scaffolding (mock coordinator gains `getScannerStatuses`)

- [x] 1.1 In `tests/unit/graviscan/session-handlers.test.ts`, add `getScannerStatuses(): Array<{ scannerId: string; status: 'ready' | 'starting' | 'error' | 'dead'; error?: string }>` to the file's local `ScanCoordinatorLike` interface (mirroring the real interface already exported from `src/main/graviscan/session-handlers.ts`), AND add a default implementation to `createMockCoordinator()`'s default object in the same commit — these two edits are not independently committable: the interface makes `getScannerStatuses` a required member, so committing it alone without the mock's implementation fails `tsc --noEmit` on every test file that constructs a `ScanCoordinatorLike`-typed mock.

  Correction made during implementation: the real `getScannerStatuses()` (`session-handlers.ts:57`) takes **zero parameters** — `retryScanner()` calls it as `coordinator.getScannerStatuses().find((s) => s.scannerId === scannerId)`, filtering client-side. An earlier draft of this task suggested `vi.fn((id: string) => [{ scannerId: id, status: 'ready' as const }])` to "echo back whichever scannerId was queried," but since the real call site never passes an id argument, that `id` parameter would always be `undefined` at runtime — producing `[{ scannerId: undefined, status: 'ready' }]`, which would never match any test's `scannerId` and would break every existing `retryScanner` test that doesn't explicitly override the mock. Used instead: `getScannerStatuses: vi.fn(() => [{ scannerId: 'sc-1', status: 'ready' as const }])` — a zero-arg mock matching the real signature, hardcoded to `'sc-1'` since that's the only scannerId any current `retryScanner` test uses (no generic "any scannerId" default is possible for a 0-arg function without closing over test-specific state, which isn't worth the complexity here).

  Ran `npx vitest run tests/unit/graviscan/session-handlers.test.ts` — the existing suite (including `startScan` tests, which don't call `getScannerStatuses`, and the pre-existing `retryScanner` happy-path test at line 446) passed unchanged, confirming this is additive and doesn't alter current behavior yet.

## 2. Red: add the failing tests for the silent-failure case

- [x] 2.1 In the `describe('retryScanner', ...)` block, add a test: `coordinator.addScanner` resolves (default mock behavior), but override `getScannerStatuses` to return `[{ scannerId: 'sc-1', status: 'error', error: 'sane_start: Invalid argument' }]`. Assert `result` equals `{ success: false, error: 'sane_start: Invalid argument' }`, and that `scanLog` was called with a message containing `sc-1`.
- [x] 2.2a Add a test: override `getScannerStatuses` to return `[]` (scanner missing entirely from the coordinator's status list). Assert `result.success === false` and `result.error` is a defined, non-empty string — do not overspecify exact wording.
- [x] 2.2b Add a test: override `getScannerStatuses` to return `[{ scannerId: 'sc-1', status: 'dead' }]` (reported dead, no `error` field). Assert `result.success === false` and `result.error` is a defined, non-empty string (the "did not come online" fallback message) — do not overspecify exact wording.
- [x] 2.3 Run `npx vitest run tests/unit/graviscan/session-handlers.test.ts`. All three new tests (2.1, 2.2a, 2.2b) MUST fail against the current `retryScanner()` implementation (which unconditionally returns `{ success: true }` after `addScanner()` resolves) — confirms the tests actually exercise the bug before any fix code is written. Confirmed: all 3 failed, all 30 pre-existing tests passed.

## 3. Green: implement the status check in `retryScanner()`

- [x] 3.1 In `src/main/graviscan/session-handlers.ts`'s `retryScanner()`: the pre-existing success log line lives inside the function's `try { ... }` block, but the pre-existing failure log line lives in the sibling `catch (error) { ... }` block — so `session` must be declared _before_ the `try`/`catch` split, not inside `try`, or the `catch`-block reference won't compile. Change:
  ```ts
  // before
  try {
    if (!sessionFns.getScanSession()?.isActive) {
      return { success: false, error: 'No active scan session' };
    }
    // ...
  } catch (error) {
    // ...
  }
  ```
  to:
  ```ts
  // after
  let session: ReturnType<SessionFns['getScanSession']> | undefined;
  try {
    session = sessionFns.getScanSession();
    if (!session?.isActive) {
      return { success: false, error: 'No active scan session' };
    }
    // ...
  } catch (error) {
    // ... use session?.sessionId / session?.currentCycle here (optional chain — TS can't
    // narrow that the `let` was assigned before this catch block runs)
  }
  ```
  Then, after `await coordinator.addScanner({ scannerId, saneName, plates: [] })` (inside `try`), look up `coordinator.getScannerStatuses().find((s) => s.scannerId === scannerId)`. If the result is missing or its `status !== 'ready'`, `scanLog()` a failure entry and return `{ success: false, error: status?.error ?? \`Scanner ${scannerId} did not come online after retry\` }`. Otherwise fall through to the existing success `scanLog()` call and `{ success: true }` return. Add `session=${session.sessionId} cycle=${session.currentCycle}` (no `?.` needed — `session` is narrowed non-null by the `if (!session?.isActive) return` guard above) to the success line and the new status-check failure line (both inside `try`, after that guard), and `session=${session?.sessionId} cycle=${session?.currentCycle}` (with `?.`, since the `let` isn't narrowed inside `catch`) to the pre-existing catch-block failure line. This matches the existing precedent set by `WedgeDetector`'s auto-pause log line (`[WedgeDetector] auto-paused scanner=... session=${evt.session_id} cycle=${evt.cycle_number}`), which added those fields specifically to disambiguate cycles across sessions sharing a calendar-day log file — the same ambiguity otherwise exists for retry outcomes.
- [x] 3.2 Update the existing happy-path retryScanner test (line ~446, "stops then respawns the scanner...") to add `expect(coordinator.getScannerStatuses).toHaveBeenCalled();` — the MODIFIED requirement's THEN clause requires this check to run on the success path too, not just the failure path, and without this assertion a regression that bypasses the check entirely on success would go uncaught.
- [x] 3.3 Run `npx vitest run tests/unit/graviscan/session-handlers.test.ts` — all tests (pre-existing + the three new ones from Task 2 + the updated happy-path assertion from 3.2) MUST pass. Confirmed: 33/33 passed.
- [x] 3.4 Run `npx tsc --noEmit` (or the project's typecheck script) to confirm the mock interface change in Task 1.1 satisfies `retryScanner()`'s real `ScanCoordinatorLike` parameter type with no `any`-casts added beyond what the test file already uses. Confirmed clean (after running `npx prisma generate`, a one-time fresh-worktree setup step unrelated to this change — the Prisma-client-generation errors it fixed did not reference `session-handlers.ts` either before or after).
- [x] 3.5 Run the full unit test suite (`npx vitest run tests/unit`) to confirm no other test file (e.g. `register-handlers.test.ts`, which mocks `retryScanner` wholesale) is affected by the interface or behavior change. Confirmed: `register-handlers.test.ts` (71/71) and the rest of `tests/unit/graviscan` unaffected. 5 unrelated pre-existing failures observed elsewhere in the full suite (Windows path-separator assertions in `config-store.test.ts`/`image-uploader.test.ts`/`scan-coordinator.test.ts`'s path-rewriting test, plus a DB-dependent `database-handlers.test.ts` test) — none touch files this change modifies (`git diff --stat` confirms only `session-handlers.ts` and `session-handlers.test.ts` changed).

## 4. Spec sync and quality gates

- [x] 4.1 Confirm `openspec/changes/fix-graviscan-retry-scanner-status-check/specs/scanning/spec.md`'s MODIFIED requirement and new scenario match the shipped behavior exactly (re-read after 3.1 lands). Confirmed.
- [x] 4.2 Run `npx openspec validate fix-graviscan-retry-scanner-status-check --strict` and resolve any issues. Passes.
- [x] 4.3 Run project lint (`/lint`) and full unit test suite (`/test`) — both green. `eslint`/`prettier --check` clean on both changed files; full suite result as noted in 3.5.

Note on commit discipline: Tasks in Section 2 (2.1-2.3) deliberately leave the suite red (new tests fail against unfixed code) — consistent with this repo's squash-merge-to-main convention (confirmed via `git log`), intermediate commits within this branch are not each individually required to pass CI; only the state after Task 3 and the final squashed PR must be green.
