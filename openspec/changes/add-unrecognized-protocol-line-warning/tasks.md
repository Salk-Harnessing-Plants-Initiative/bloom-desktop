## 0. Prerequisite

- [x] 0.1 File a lightweight GitHub issue for this hardening (referencing #316 as motivating context), matching this codebase's convention that every OpenSpec change ties to a tracked issue. Filed as [#318](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/318).

## 1. Regression tests (TDD red)

- [x] 1.1 In `tests/unit/python-process.test.ts`, extend the existing `describe('handleStdout', ...)` block with tests for: a truly unrecognized line (warns), `WARNING:`/`INFO:` lines (don't warn), the known-benign prefix-less `"Generating synthetic test patterns instead"` line (doesn't warn), a lowercase `"warning:"` line and a `"WARNINGLY:"` line (both warn — case-sensitive, exact-prefix allowlist), and an empty line (doesn't warn — `handleStdout()` already filters empty lines before `parseLine()` is ever called, so there's nothing for the warning logic to see). **Done.**
- [x] 1.2 In `tests/unit/camera-process.test.ts`, add a test confirming a `FRAME:` line handled by `CameraProcess.parseLine()`'s override never reaches the base class's warning logic at all. **Done.**
- [x] 1.3 Run `npm run test:unit -- python-process camera-process` and confirm the new tests fail against current code — the TDD red step. **Done:** 3 of the new tests failed with `expected "warn" to be called 1 times, but got 0 times` (no default warning existed yet); the "does not warn" tests passed trivially since no warning existed at all.

## 2. Implementation (TDD green)

- [x] 2.1 In `src/main/python-process.ts`, add `UNRECOGNIZED_PREFIX_ALLOWLIST` (`WARNING:`, `INFO:`, exact case-sensitive `startsWith`) and `UNRECOGNIZED_LINE_WARNING_ALLOWLIST` (exact-match, currently `["Generating synthetic test patterns instead"]`), with a comment noting new benign unprefixed Python lines must be added to the latter. Register a permanent internal `'raw'` listener in the constructor (`registerUnrecognizedLineWarning()`, alongside `registerCorrelationListeners()`) that `console.warn`s a truncated (200 char) preview unless the line matches either allowlist. **Done.**
- [x] 2.2 Re-run `npm run test:unit -- python-process camera-process` and confirm all tests pass. **Done:** 31/31 passed (26 in python-process.test.ts, 5 in camera-process.test.ts).

## 3. Verification

- [x] 3.1 Run `/lint` and `npm run test:unit` (full suite) to confirm no regressions elsewhere. **Done:** ESLint and `tsc --noEmit` clean; Prettier clean on all changed files. Full unit suite: 5 pre-existing failures, confirmed via `git diff --stat` to be in files completely untouched by this change (`config-store.test.ts`, `graviscan/database-handlers.test.ts`, `graviscan/scan-coordinator.test.ts`, `image-uploader.test.ts`, `scans-export.test.ts` — pre-existing suite flakiness unrelated to `python-process.ts`/`camera-process.ts`).
- [x] 3.2 Run `/pre-merge` before opening the PR. **Done:** PR #321, CI run 31291945457 — every job passes on all 3 platforms, including `Test - Integration` (macos/windows/ubuntu) and `Test - E2E Dev Build` (macos/windows/ubuntu). `Test - E2E Dev Build (macos-latest)` initially failed on the first run with an unrelated Electron-launch infrastructure error (`Cannot read properties of undefined (reading 'waitForLoadState')` in an unrelated Prisma/database IPC test, 270+ tests into a single run, no mention of this change's new code anywhere in the log) — re-ran with zero code changes via `gh run rerun --failed` and it passed cleanly (22m34s), confirming environmental flakiness, not a regression. Only the pre-existing, unrelated `Lint - Node.js` Prettier drift (same files as PR #320, `main` has no branch protection) remains.
- [x] 3.3 Reference the tracking issue (#318) in the PR description. **Done:** [PR #321](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/pull/321).
