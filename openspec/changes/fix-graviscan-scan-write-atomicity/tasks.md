## 0. Baseline

- [x] 0.1 Run `npm run test:unit` and `uv run pytest python/tests -v --cov=python --cov-report=term` fresh, right before starting. Fresh baseline confirmed: Python — 6 pre-existing failures (`test_camera_streaming.py::test_scan_capture_still_saves_png`, `test_scan_worker.py::TestUSBResetPathConstruction::test_path_from_device_name`, `test_tiff_metadata.py`'s 4 `TestMockScanTiffMetadata` tests — all a Windows-only `PermissionError` on `tmp_path` teardown, unrelated to this change). TS — pre-existing flakiness in `AccessionForm.test.tsx`/`MachineConfiguration.test.tsx` unrelated to graviscan code; scoped test runs used instead of relying on full-suite counts for TS during this change.

## 1. Python: atomic write helper and wiring (TDD)

- [x] 1.1 Write a failing test in `python/tests/test_scan_worker.py` for a new `_atomic_image_save()` helper: patch `Image.save` with a `side_effect` callable that actually writes partial bytes to the path it's called with (the temp path) and then raises (e.g. `OSError`) — a bare exception-raising mock performs no real I/O and cannot validate this scenario. Assert: (a) no file exists at `final_path` afterward, (b) exactly one `.tmp-*` file exists in the directory (proving the temp file was created and never promoted), (c) the exception propagates to the caller (not swallowed).
- [x] 1.2 Write a failing test: using a real small `PIL.Image` (no mock — matching the existing pattern in `test_tiff_metadata.py`/`TestFullScanCycleMock`), call `_atomic_image_save()` and assert a file exists at exactly `final_path` with correct content, and no `.tmp-*` file remains in that directory afterward.
- [x] 1.3 Write a failing test asserting write-then-rename _order_, not just end-state: mock `os.replace` with a `side_effect` that itself asserts, at call time, that `final_path` does NOT yet exist and the temp path DOES exist with the expected content — this proves the implementation can't satisfy the test via a direct-write-then-no-op-temp-file shortcut.
- [x] 1.3a Write a failing test for `os.replace()` overwriting a pre-existing file at `final_path` without raising (the specific reason `os.replace()` was chosen over `os.rename()`) — create a dummy file at `final_path` first, then call `_atomic_image_save()`, and assert it succeeds and the file now has the new content.
- [x] 1.3b Write a failing test for a rename failure _after_ a successful save: mock `os.replace` to raise (e.g. `PermissionError`) after the temp file was genuinely written; assert the exception propagates (not caught/swallowed by the helper) and no file exists at `final_path`.
- [x] 1.4 Implement `_atomic_image_save(image, final_path, *save_args, **save_kwargs)`: writes to a temp file (`.tmp-<uuid4>-<final_basename>`) in the same directory as `final_path`, then calls `os.replace(tmp_path, final_path)` only after the save succeeds; forwards `*save_args, **save_kwargs` to `image.save()` unchanged (both current call sites pass `"TIFF"` positionally). Confirm tests from 1.1-1.3b pass.
- [x] 1.5 Wire `_sane_scan()` to call `_atomic_image_save()` instead of `image.save(final_path, ...)` directly.
- [x] 1.6 Wire `_mock_scan()` to call the same helper (it currently duplicates the identical direct-save pattern).
- [x] 1.7 Write a failing integration-style test: spawn a real `scan_worker.py --mock` subprocess, send a `scan` command, and SIGKILL it mid-write. Implemented via a test-only `GRAVISCAN_TEST_SLOW_WRITE_MS` env-var hook (no-op unless set) so the kill's timing is deterministic rather than a race; confirmed stable across 5 repeated runs (~1.8s each).
- [x] 1.8 Updated the stale docstring/comments in `TestRealHardwarePathComposition` that claimed "no write-then-rename."
- [x] 1.9 Ran `uv run pytest python/tests -v --cov=python --cov-report=term` — same 6 pre-existing failures as the 0.1 baseline, 6 new tests passing, no regressions (284 passed vs. 278 before).

## 2. TypeScript: image-handlers.ts excludes stray temp files (TDD)

- [x] 2.1 Wrote failing tests in `tests/unit/graviscan/image-handlers.test.ts` for both flat mode and base-dir/subfolder mode: a directory containing a `.tmp-<uuid>-...tif` file alongside a real `.tif` — `listScanFiles()` must exclude the former and include the latter.
- [x] 2.2 Implemented the exclusion (`.tmp-` prefix check) at both filter sites in `listScanFiles()`. All 39 tests in the file pass, no existing test broke.

## 3. TypeScript: discriminated row outcome and exit-only diagnostic in `scanOnce()` (TDD)

- [x] 3.1 Wrote a failing test using a 4grid scanner (2 plates per row group, exits on every `sub.scan()` call across both row groups — 4 plates total): asserts `scanLog()` fires once per plate (4 calls, all 4 plate indices present, cycle number included) and no `scan-error` is emitted as a result.
- [x] 3.2 Wrote a failing test confirming the timeout path is NOT double-logged by the new exit diagnostic — 0 "no completion signal received" calls, existing "Row scan timeout" log still fires.
- [x] 3.3 Implemented the discriminated `RowOutcome` type (`{scannerId, outputPaths}` / `{scannerId, rowPlates, reason: 'exit'}` / `{scannerId, rowPlates, reason: 'timeout'}`) and the verification loop's `'reason' in result` branch. Both tests pass.
- [x] 3.4 The `!this.cancelled` guard is defense-in-depth (the outer `if (this.cancelled) break;` already makes it unreachable as `true` in practice) — documented in design.md's Decision 2 rather than added as a vacuous duplicate of the existing "skips file verification after cancel during active row" test.
- [x] 3.5 Ran `npx vitest run tests/unit/graviscan/scan-coordinator.test.ts` and `tests/unit/graviscan/image-handlers.test.ts` — 55/55 and 39/39 passing, no regressions.

## 4. Regression coverage confirming #281 items 2/3 stay fixed

- [x] 4.1 Confirmed existing test "two concurrent addScanner() calls for a new id while idle spawn exactly one subprocess" (line ~481, from PR #357) — already covers the `spawnInFlight` guard, already passing.
- [x] 4.2 Confirmed existing test "a spawn attempt that never confirms readiness triggers a reclaim..." (line ~691, from PR #357) — already covers the `SPAWN_READY_TIMEOUT_MS` bound and `scanner-init-status: error` reporting, already passing.

## 5. Validation

- [x] 5.1 Ran `npm run test:unit` full suite: 6 failed / 1988 passed / 9 skipped (2003 total). All 6 failures are pre-existing, unrelated flakiness (`AccessionForm.test.tsx` x2, `electron-cleanup` descendant-kill timing tests x4) — none touch graviscan code. Targeted files (`scan-coordinator.test.ts`, `image-handlers.test.ts`) are 94/94 green. Ran `uv run pytest python/tests`: identical 6 pre-existing failures as the 0.1 baseline, 284 passed, no regressions.
- [x] 5.2 Ran `black`/`ruff` on changed Python files (black reformatted whitespace only, ruff clean) and `eslint` on changed TS files (clean — worked around a pre-existing worktree ESLint config-cascade quirk unrelated to this change via `--resolve-plugins-relative-to .`; the ancestor-checkout's `.eslintrc.json` lacking `root: true` is a separate, out-of-scope environment issue). `tsc --noEmit` shows no errors in any file this change touches (pre-existing, unrelated Prisma-generated-type errors exist elsewhere in the worktree).
- [x] 5.3 `openspec validate fix-graviscan-scan-write-atomicity --strict` passes.

## 6. GitHub bookkeeping (after merge)

- [ ] 6.1 Close #281, referencing this PR and the earlier comment noting items 2/3 were already resolved by PR #357.
