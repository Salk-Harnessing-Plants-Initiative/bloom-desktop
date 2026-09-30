## Conventions for every test task below

- New test files are main-process modules, so each needs the `// @vitest-environment node` pragma (`vitest.config.ts` defaults to `happy-dom`).
- Every test that transitively imports `diagnostics-log` MUST mock `fs` and `os.homedir`. No test may touch the real `~/.bloom/` — this project has a prior incident where an ad-hoc script overwrote `~/.bloom/.env`.
- `§3` reuses the existing `createMockIpcMain()` pattern from `tests/unit/graviscan/register-handlers.test.ts`; extract it to `tests/unit/helpers/` so all call sites share one copy.
- `§3`'s thresholds and clock are **injected** (`now: () => number`), so tests advance a fake clock rather than sleeping. No real 3-second waits.
- `npx tsc --noEmit` only covers `src/**` per `tsconfig.json`, so it does **not** typecheck these test files. `vitest.config.ts` excludes `src/main/**` from coverage with all thresholds at 0, so the new modules face no coverage gate — do not expect the coverage report to reflect this work.

## 0. Preconditions

- [ ] 0.1 Confirm the branch is based on `main` and that file sets are disjoint from **every** open PR touching `src/main/main.ts` — not just #382. Check #382, #237 (draft), and #227 (stale long-running branch). Note #321 adds another ADDED delta in `ipc-reliability`, which needs ordering at archive time, not merge time.
- [ ] 0.2 Record the pre-existing baseline **using CI's own command and environment**: `BLOOM_DATABASE_URL='file:./dev.db' npm run test:unit:coverage`, output saved to a file for later comparison. Verified expectation: **2190 passed, 1 suite failing** — `tests/unit/electron-cleanup.test.ts`, which passes 14/14 in isolation but fails 2–3 of its `descendant snapshot/kill` tests under full-suite parallel load because it spawns real child processes. `tests/unit/graviscan/database-handlers.test.ts` passes 106/106 **only** when `BLOOM_DATABASE_URL` is set (its own header documents this; CI sets it) — without it, it fails deterministically, which is provisioning, not flakiness. Any _other_ failure after this change is attributable to this change.
- [ ] 0.3 Lint in this worktree with `npx eslint --ext .ts,.tsx --resolve-plugins-relative-to . src tests` (`npm run lint` is unusable in a worktree nested under the repo: `.eslintrc.json` lacks `"root": true`, so ESLint walks up and fails on a duplicate `import` plugin). Note this covers a **narrower** file set than CI's root `eslint .`, so also confirm the change adds no `.ts`/`.tsx` outside `src/` and `tests/`.

## 1. Diagnostics log sink (`src/main/diagnostics-log.ts`)

TDD: `tests/unit/diagnostics-log.test.ts`, modelled on `tests/unit/graviscan/scan-logger.test.ts`.

- [ ] 1.1 **Test first** — writes an ISO-8601 line ending in `Z` to `~/.bloom/logs/diagnostics-<UTC-today>.log`. Verifies UTC path derivation and timestamp format. _(Diagnostics Log Sink)_
- [ ] 1.2 **Test first** — creates `~/.bloom/logs/` recursively with mode `0700` and the file with mode `0600`.
- [ ] 1.3 **Test first** — a throwing `fs` never propagates.
- [ ] 1.4 **Test first** — rotates to a new file when the UTC date changes.
- [ ] 1.5 **Test first** — three sequential entries appear in the file in write order, each one complete line. Verifies the single-append-path ordering guarantee the breadcrumb analysis depends on.
- [ ] 1.6 **Test first** — newlines in logged content are escaped, so content cannot forge a line resembling a breadcrumb record.
- [ ] 1.7 **Test first (real durability, not a mock assertion)** — spawn a child `node -e` process with `HOME` **and** `USERPROFILE` pointed at a fresh `os.tmpdir()` directory, have it import the real unmocked module, write an entry, print `ready`, then idle. On `ready`, the parent sends `SIGKILL`, waits for exit, then reads the log and asserts the entry is present. Replaces a mocked "calls `appendFileSync`" assertion, which would only prove the code calls what it was told to call.
- [ ] 1.8 **Test first** — with `BLOOM_DIAGNOSTICS=0`, writes are no-ops: no `mkdirSync`, no `appendFileSync`, no file created. _(Diagnostics Subsystem Toggle)_
- [ ] 1.9 **Test first** — toggle parsing: only `'0'` after trimming disables; unset, `''`, `'1'`, `'true'`, `'false'`, `'off'` all leave diagnostics enabled.
- [ ] 1.10 **Test first** — first write failure is reported once to stderr and marks the subsystem degraded; a later successful write records that entries were lost and how many. _(Write-Failure Visibility)_
- [ ] 1.11 **Test first** — retention deletes only out-of-window `diagnostics-*.log`, leaving in-window ones and all `graviscan-*.log` untouched; default 180 days; `BLOOM_DIAG_LOG_RETENTION_DAYS` override with fallback on absent/non-numeric/zero/negative; a file exactly at the window boundary is retained. _(Volume Bounds)_
- [ ] 1.12 **Test first** — cleanup also runs on UTC date rollover without a restart, and tolerates a file another instance holds open (Windows `unlinkSync` raises `EPERM`/`EBUSY`).
- [ ] 1.13 **Test first** — repeated identical entry signatures are counted and summarised rather than written individually; a per-day byte cap writes one final `LOG-CAPPED` entry and then stops.
- [ ] 1.14 **Test first** — redaction: a URL's path/query/user-info is stripped; a known secret value is masked wherever it appears. _(Never Record Secrets)_
- [ ] 1.15 Implement `diagnostics-log.ts`: `diagLog()` (synchronous), `cleanupOldDiagnosticsLogs()`, `writeRunStart()`, `writeRunEnd()`, `redact()`. There is deliberately **no** buffered path.
- [ ] 1.16 Lint + `BLOOM_DATABASE_URL='file:./dev.db' npm run test:unit:coverage`; mark green.

## 2. Event-loop lag probe (`src/main/event-loop-probe.ts`)

TDD: `tests/unit/event-loop-probe.test.ts`. The log sink **and** the histogram factory are injected, so most tests need no real lag — but see 2.6, which must not be mocked.

- [ ] 2.1 **Test first** — a sample above threshold logs one entry reporting the maximum **in milliseconds**. _(Lag Monitoring)_
- [ ] 2.2 **Test first** — samples below threshold log nothing.
- [ ] 2.3 **Test first** — lag exactly equal to the threshold is **not** reported (strictly-greater semantics).
- [ ] 2.4 **Test first** — after a breach is reported the histogram is reset, so a following quiet interval logs nothing. Verifies one block produces one entry, not one per sample forever.
- [ ] 2.5 **Test first** — `BLOOM_DIAG_LOOP_LAG_WARN_MS` override, with fallback to 1000 ms on absent/non-numeric/zero/negative.
- [ ] 2.6 **Test first (real histogram, real timers, NOT mocked)** — construct the probe with its **default** factory, threshold 50 ms, sample interval 25 ms; busy-wait synchronously for ~200 ms; let one sample fire; assert exactly one entry is logged and the reported figure is in the 150–500 **ms** range, not ~1e8. This is the only test that exercises the nanosecond→millisecond conversion and the default `monitorEventLoopDelay` wiring; a fully mocked histogram would let a missing or inverted conversion ship green. Runtime ~300 ms.
- [ ] 2.7 **Test first** — a lag breach dumps the in-flight IPC records (via the injected provider from §3).
- [ ] 2.8 **Test first** — `stop()` clears the sampling timer, disables the histogram, and is safe to call twice.
- [ ] 2.9 Implement. Record the sampling interval and histogram resolution so §5 can include them in `RUN-START`.
- [ ] 2.10 Add code comments recording the two blind spots: breaches are reported **retrospectively** (an unending block logs nothing — hence §3's breadcrumbs), and a block during module evaluation at startup is not measurable as loop delay because the loop has not begun idling.
- [ ] 2.11 Lint + tests green.

## 3. IPC watchdog (`src/main/ipc-watchdog.ts`)

Implemented **before** process diagnostics, because §4's unresponsive-dump needs this module's in-flight registry. TDD: `tests/unit/ipc-watchdog.test.ts`.

- [ ] 3.1 **Test first** — install, then register handlers on the fake `ipcMain`; every registration is instrumented and each invocation recorded exactly once. _(Watchdog Installation)_
- [ ] 3.2 **Test first** — a second `install()` does not double-wrap.
- [ ] 3.3 **Test first** — `uninstall()` restores a **saved reference** to the original function and registration still works afterwards. Note `handle` is an own, writable, configurable property with nothing on the prototype, so `delete` or prototype-restore would destroy the method.
- [ ] 3.4 **Test first (real modules, three registrars)** — with `electron` mocked, install on the mocked `ipcMain`, then call the real `registerDatabaseHandlers()` (which imports the singleton directly) and the real `registerGraviScanHandlers(ipcMain, …)` (which receives it as a parameter); assert every channel each registers is instrumented. This is what proves Decision 1's two different access patterns are both covered.
- [ ] 3.5 **Test first (transparency — highest-risk area)** — resolved values pass through structurally unchanged for all three real envelope shapes: `{success,data}`, `{success,error}`, and a bare non-object value. _(Watchdog Transparency)_
- [ ] 3.6 **Test first** — a promise rejection propagates with the original message and is never converted to a resolved value.
- [ ] 3.7 **Test first** — a handler that **throws synchronously** propagates the original error, its registry entry is removed, and a risk-listed channel still gets its end breadcrumb.
- [ ] 3.8 **Test first** — a handler returning a **non-promise** value works unchanged and its registry entry is removed.
- [ ] 3.9 **Test first** — the IPC event object and all arguments reach the handler unchanged.
- [ ] 3.10 **Test first** — registering the same channel twice still raises Electron's duplicate-handler error through the wrapper.
- [ ] 3.11 **Test first** — a handler exceeding its threshold still delivers its result; never cancelled or aborted.
- [ ] 3.12 **Test first** — a slow handler logs one entry with channel, invocation id, and duration carrying an explicit `ms` unit; a fast handler logs nothing; a duration exactly at the threshold logs nothing; a slow **rejecting** handler is still reported. _(Slow IPC Handler Detection)_
- [ ] 3.13 **Test first** — `app:wait-until-ready` and `config:browse-directory` are never reported however long they take.
- [ ] 3.14 **Test first** — per-channel thresholds: `graviscan:reset-usb` at 90 000 ms logs nothing at 60 000 ms and reports at 120 000 ms; `BLOOM_DIAG_IPC_WARN_MS` overrides the general default.
- [ ] 3.15 **Test first** — **no payloads**: neither arguments nor return values appear in any entry; specifically, invoking `config:fetch-scanners` with a password and anon key produces breadcrumbs, a slow-call entry, and an in-flight dump containing **neither** sentinel value. _(Records No Payloads)_
- [ ] 3.16 **Test first** — a risk-listed channel writes a start breadcrumb **before the handler body runs and before the wrapper's first `await`**, and a matching end breadcrumb with duration after it settles. Ordering is the whole point. _(In-Flight Breadcrumbs)_
- [ ] 3.17 **Test first** — a risk-listed handler returning `new Promise(() => {})` leaves an unmatched start breadcrumb. **Invoke the wrapper without awaiting it** and assert synchronously on the log and registry; a bare pending promise does not hold Node's event loop open, but awaiting it would hit the Vitest timeout.
- [ ] 3.18 **Test first** — two concurrent invocations of the **same** risk-listed channel get distinct invocation ids, and each start breadcrumb is matched by the end bearing the same id.
- [ ] 3.19 **Test first** — when only the first of two concurrent same-channel calls settles, exactly one start breadcrumb is unmatched and is identifiable as the second invocation.
- [ ] 3.20 **Test first** — a non-risk-listed channel invoked repeatedly writes no breadcrumbs.
- [ ] 3.21 **Test first** — the registry is keyed by invocation id: two concurrent same-channel calls are two entries, the first settling leaves the second reported with its own elapsed time, and entries are removed on resolve, reject, and synchronous throw with no leak. _(In-Flight Registry)_
- [ ] 3.22 **Test first** — the registry dump goes through the synchronous path and contains channels, ids, and elapsed times only.
- [ ] 3.23 **Test first** — circuit breaker: a synchronous breadcrumb write that exceeds its bound or fails disables the breadcrumb path for the run and records the disablement; slow-call reporting continues; handler results are unaffected. _(Circuit Breaker)_
- [ ] 3.24 **Test first (structural cost guard, not wall-clock)** — one risk-listed invocation produces exactly two `appendFileSync` calls, each a single line under 200 bytes, with no `fsync`. Deliberately **not** a timing assertion: the measured cost is ~1 ms median, and on a shared CI runner a sub-millisecond assertion would be flaky to failing.
- [ ] 3.25 **Test first** — with `BLOOM_DIAGNOSTICS=0`, `install()` leaves `ipcMain.handle` as the original and records nothing.
- [ ] 3.26 Implement. Risk list and per-channel thresholds per `design.md` Decisions 3 and 5. Document `handleOnce` as an uninstrumented trip-wire.
- [ ] 3.27 Lint + tests green.

## 4. Process diagnostics (`src/main/process-diagnostics.ts`)

TDD: `tests/unit/process-diagnostics.test.ts`, with `vi.mock('electron')` supplying fake `app`, `crashReporter`, and `EventEmitter`-based `webContents`. Takes an injected `getInFlightIpc: () => Array<{channel, id, elapsedMs}>` provider defaulting to `() => []`; §5 wires it to §3's registry.

- [ ] 4.1 **Test first** — `crashReporter.start()` is called with `uploadToServer: false`. _(Local Crash Report Capture)_
- [ ] 4.2 **Test first** — the runtime-resolved crash-dump directory is logged, and starting the crash handler is recorded as a process-tree change.
- [ ] 4.3 **Test first** — crash-dump pruning removes minidumps beyond the age/count limit.
- [ ] 4.4 **Test first** — `unresponsive` logs a blocked-renderer entry; a following `responsive` logs recovery **with elapsed ms**. _(Renderer Responsiveness)_
- [ ] 4.5 **Test first** — listeners are attached **per window creation**, so a window destroyed and recreated (as `app.on('activate')` does) is still monitored.
- [ ] 4.6 **Test first** — `unresponsive` dumps the in-flight IPC records via the injected provider.
- [ ] 4.7 **Test first** — `child-process-gone` with type `GPU` logs type, reason, and exit code; `render-process-gone` logs reason and exit code. _(Process Loss Logging)_
- [ ] 4.8 **Test first** — uncaught exceptions are observed via `process.on('uncaughtExceptionMonitor')`, logging name, stack, and redacted message. Assert the handler is registered on **`uncaughtExceptionMonitor`, not `uncaughtException`** — registering the latter replaces Node's default print-and-exit, turning a crash into a process limping on in corrupted state. _(Unhandled Error Logging)_
- [ ] 4.9 **Test first** — the process still terminates with its pre-existing non-zero exit code after an uncaught exception is logged.
- [ ] 4.10 **Test first** — `unhandledRejection` is logged and the process's default rejection behaviour is preserved.
- [ ] 4.11 **Test first** — a non-`Error` rejection reason records only its type and constructor name, and **none** of its property values.
- [ ] 4.12 **Test first** — a rejection reason containing the Slack webhook URL or a credential produces an entry containing neither.
- [ ] 4.13 **Test first** — a freeze indicator during a scan records session, experiment, wave, and scanner identity; outside a scan it records that none was active; and a correlating pointer is written to the scan log. _(Freeze Indicator Scan Context)_
- [ ] 4.14 **Test first** — with `BLOOM_DIAGNOSTICS=0`, no listeners are registered and `crashReporter.start()` is not called.
- [ ] 4.15 Implement, following the `IdleTimer` house style (injected dependencies, explicit `start`/`stop`, validated options).
- [ ] 4.16 Lint + tests green.

## 5. Wiring (`src/main/diagnostics.ts` + two calls in `main.ts`)

**No test in this repo imports `src/main/main.ts`** — it has unconditional load-time Electron side effects, and `tests/unit/graviscan-system-name-hydration.test.ts` says so explicitly. So the wiring is extracted, exactly as GraviScan already did with `wiring.ts`. TDD: `tests/unit/diagnostics-wiring.test.ts`, modelled on `tests/unit/graviscan/main-wiring.test.ts` (**not** `main-idle-integration.test.ts`, which replicates a closure rather than testing `main.ts`).

- [ ] 5.1 **Test first** — `initDiagnostics(deps)` installs the IPC watchdog, starts `crashReporter`, registers process listeners, starts the lag probe, runs retention cleanup, and writes `RUN-START`; `shutdownDiagnostics()` stops the probe, dumps in-flight IPC, and writes `RUN-END`. All Electron surfaces injected.
- [ ] 5.2 **Test first** — `initDiagnostics` wires the lag probe's and process-diagnostics' `getInFlightIpc` provider to the watchdog's real registry. Without this the provider silently stays `() => []` and the dump never fires — a gap no other test would catch.
- [ ] 5.3 **Test first (source-order assertion)** — read `src/main/main.ts` as text and assert the line index of `initDiagnostics(` is lower than the first `ipcMain.handle(` and lower than the first `app.on('ready'`. This is the only mechanism in this repo that can verify module-scope ordering, and it is the invariant all of Decision 1 rests on. Precedent: nine existing unit tests read source or config as text.
- [ ] 5.4 **Test first** — `RUN-START` records pid, run id, app version, Electron/Chromium/Node versions, platform, arch, scanner mode, and the effective thresholds including the lag sampling interval and resolution. _(Run Identity)_
- [ ] 5.5 **Test first** — all four subsystems are wired in **both** `cylinderscan` and `graviscan` mode.
- [ ] 5.6 **Test first** — with no diagnostics env vars set at all, everything is wired with defaults 3000 / 1000 / 180.
- [ ] 5.7 **Test first** — with `BLOOM_DIAGNOSTICS=0`, none of it is wired.
- [ ] 5.8 **Test first** — `shutdownDiagnostics()` is reached even when an earlier `before-quit` step rejects (i.e. it runs in a `finally`, or before the `try`). `before-quit` ends with `app.exit(0)` and awaits no flush, so nothing load-bearing may depend on a deferred write.
- [ ] 5.9 Implement `diagnostics.ts` and reduce the `main.ts` change to two calls.
- [ ] 5.10 Lint + tests green.

## 6. Documentation

- [ ] 6.1 `docs/TROUBLESHOOTING.md`: a new logging section — log location, line formats, how to read an unmatched start breadcrumb, how to tell a previous run's entries apart by run id, and the instruction to **`kill -9` a frozen app rather than hold the power button**, since breadcrumbs are not `fsync`ed and will not survive power loss.
- [ ] 6.2 `docs/CONFIGURATION.md`: add all four variables to the Environment Variables table (which currently has exactly one row) with defaults, valid ranges, and invalid-value behaviour — and state explicitly that they are **launch-environment** variables with no effect in `~/.bloom/.env`, alongside the existing `GRAVISCAN_LOG_RETENTION_DAYS` so nobody sets the wrong one.
- [ ] 6.3 Record the crash-dump directory's platform dependence, that `uploadToServer` is `false` so nothing leaves the machine, and that **minidumps may contain credentials (the Slack webhook URL is in the process environment) and must not be attached to issues, Slack, or PRs**.
- [ ] 6.4 Note the lag probe's two blind spots so an absent lag warning is not misread as an absent block.
- [ ] 6.5 `docs/GRAVISCAN_LINUX_DEPLOYMENT.md`: the shell-only caveat for the env vars on the rig.
- [ ] 6.6 Run `npm run format:check` (Prettier covers `**/*.md`, and CI's Lint job runs it) and the worktree-safe ESLint; mark green.

## 7. Verification

- [ ] 7.1 `npx openspec validate add-freeze-diagnostics --strict`.
- [ ] 7.2 Full sweep matching CI: `npm run format:check`, the worktree-safe ESLint command **plus** confirmation that no `.ts`/`.tsx` was added outside `src/`/`tests/`, `npx tsc --noEmit`, and `BLOOM_DATABASE_URL='file:./dev.db' npm run test:unit:coverage`. Diff against the §0.2 recorded baseline and account for every difference.
- [ ] 7.3 Confirm the IPC coverage gate still passes. `scripts/check-ipc-coverage.py` extracts handlers from `src/main/database-handlers.ts` only and matches them against `tests/e2e/renderer-database-ipc.e2e.ts` at a 90% threshold; this change adds no handler there, so no new E2E coverage is owed — verify rather than assume.
- [ ] 7.4 State explicitly that no `python/` file is touched, so `lint-python` and `test-python` are unaffected. (`scripts/check-ipc-coverage.py` is Python but sits outside `python/` and is neither linted nor pytest-covered.)
- [ ] 7.5 Confirm the E2E matrix passes on **Linux, macOS and Windows**. This is the change's only platform coverage. Specifically confirm that four concurrent E2E shards appending to one `diagnostics-<date>.log` produce no crash, and that startup retention never fails on a file another instance holds open. Run E2E in CI or on the rig — **not** on a workstation, where it would create a real `~/.bloom/logs/`.
- [ ] 7.6 Note that `tests/integration/database*.test.ts` run in CI on all three OSes and are unaffected by this change.

### Manual hardware steps — not CI, and not merge blockers

`design.md` records the decision that #381's criterion 2 is out of scope for this change, so 7.7–7.11 follow the merge rather than gating it. #381 stays open regardless.

- [ ] 7.7 **[MANUAL — real hardware]** On rig `pbiob-gh-04`: launch via `npm start` (never `npm run dev` or `npm run build:python` — they uninstall `python-sane`), with `ELECTRON_DISABLE_SANDBOX=1`, under tmux, dev server on port 9000. Back up `~/.bloom/.env` first and verify it is byte-identical to that backup afterwards.
- [ ] 7.8 **[MANUAL — real hardware]** Confirm `~/.bloom/logs/diagnostics-*.log` is created, `RUN-START` appears with the expected identity fields, and Crashpad actually initialises under `ELECTRON_DISABLE_SANDBOX=1` rather than being assumed to.
- [ ] 7.9 **[MANUAL — real hardware]** Measure the real per-breadcrumb `appendFileSync` cost over ~1000 writes under concurrent scan I/O and record the median in `design.md`, replacing the workstation figure.
- [ ] 7.10 **[MANUAL — real hardware] Positive control.** Prove the hypothesis' _signature_ and that the instrumentation actually fires, rather than waiting for a spontaneous freeze: via a debug-only path, block the main process synchronously for ~60 s, then confirm (a) the window keeps painting while every click is ignored — matching the operator's report — and (b) the diagnostics log reports the lag breach and names the blocking channel. Without this, 7.11 can pass with "no freeze occurred" and tell us nothing about whether the instrument works.
- [ ] 7.11 **[MANUAL — real hardware]** Attended session on the real display, ≥30 min, ideally a multi-cycle interval scan. If a freeze occurs, determine from the log whether it was a blocked main loop, a blocked renderer, or a never-settling IPC call — and which channel.
- [ ] 7.12 Update #381 with the outcome, and tell PR #382's owner the rig is usable for task 4.4 again.
