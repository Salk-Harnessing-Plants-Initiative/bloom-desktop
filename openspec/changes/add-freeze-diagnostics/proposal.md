## Why

The GUI froze on dev rig `pbiob-gh-04` and blocked GraviScan #182's attended task 4.4 (#381), and nobody could say why, because the app produces no evidence about its own liveness. Empirical work on the rig then **refuted** #381's stated cause — eight induced GPU-process crashes never stopped repainting — while the operator's actual report, _window painted normally, every click ignored_, points instead at a blocked main-process event loop, which is also unproven. See `design.md` for the full record; the findings are posted in #381.

## What Changes

- Add `src/main/diagnostics-log.ts`: a diagnostics sink at `~/.bloom/logs/diagnostics-YYYY-MM-DD.log`, in **both** scanner modes, with ISO-8601 UTC timestamps, daily rotation, 180-day retention matching the scan log, a per-day byte cap, mode `0600`, and **all** writes synchronous so entries are on disk before the call returns and the file stays in total write order.
- Add a **main-process event-loop lag probe** (`perf_hooks.monitorEventLoopDelay`, converting its nanosecond output to milliseconds). This is the instrument that can see a synchronous block such as `execFileSync('lsusb')`, which a duration-only watchdog cannot report while it is happening.
- Add a **slow-IPC watchdog** as a single decorator over `ipcMain.handle`, installed before the first registration in `src/main/main.ts`, covering all 107 handlers. It times every handler, reports breaches against per-channel thresholds, and writes **per-invocation start/end breadcrumbs** for a risk-listed set of channels so an _indefinite_ block still names the culprit on disk.
- Maintain an **in-flight IPC registry** keyed by invocation id, dumped when the renderer goes unresponsive, when a lag breach fires, and on `before-quit`.
- Log renderer liveness transitions via `webContents.on('unresponsive')`/`on('responsive')` with blocked duration, attached per window creation so a window recreated on `activate` is still monitored.
- Log `render-process-gone` and `child-process-gone` (the latter captures GPU crashes like #383's automatically from now on).
- Start `crashReporter` with `uploadToServer: false` so minidumps are written locally, and record the runtime-resolved crash-dump directory.
- Log unhandled main-process errors via `uncaughtExceptionMonitor` — **not** an `uncaughtException` listener, which would suppress Node's default exit and turn a crash into a process limping on in corrupted state.
- Record a `RUN-START`/`RUN-END` identity block (pid, run id, app and Electron/Chromium/Node versions, platform, scanner mode, effective thresholds), so entries from a killed process are distinguishable from the live run's in the same daily file.
- Never record IPC argument or return values; redact URLs and known secrets from logged error text; never serialise non-`Error` rejection reasons; escape newlines so logged content cannot forge a breadcrumb line.

## Non-Goals

Deliberately excluded to keep this change reviewable and collision-free. This list is authoritative; `design.md` does not duplicate it.

- **No GPU mitigation.** The NVIDIA `libnvidia-glcore` segfaults are real and reproducible but are not this freeze; filed as **#383**. No `disableHardwareAcceleration()`, no GPU launch flags.
- **No converting the four synchronous `detectEpsonScanners()` call sites** in `src/main/graviscan/scanner-handlers.ts`. PR #382 adds `detectEpsonScannersAsync()` and its Decision 4 deliberately leaves those four synchronous; changing them here would collide. Evidence-led follow-up once #382 merges.
- **No fix for the freeze itself.** This change only observes. It cannot satisfy #381's criterion 2 (surviving a ≥30 min session), which is not achievable by a zero-behaviour diagnostic — so **#381 stays open on merge**, and merging is not progress against that criterion.
- **No renderer error boundary or global renderer error handler.** A different failure mode (a render throw producing a blank window) from the reported symptom, and it would need a new renderer→main channel. Not filed yet; worth filing if the attended reproduction implicates the renderer.
- **No operator-facing surfacing.** This is developer-facing: reading the log needs SSH, which widens the gap already tracked in #363. Accepted, not solved.
- **No fix for #366.** That is a never-settling `await`, which leaves the main loop healthy and the UI responsive, so it does not match "all clicks ignored" — though because `graviscan:retry-scanner` is risk-listed, an unmatched breadcrumb would name it.
- **#287 and #368 are not covered.** #287's handler resolves with `{success: false}` and the defect is renderer-side, so the diagnostics log would look healthy throughout. #368's scan-worker death is a `child_process` exit, which `child-process-gone` does not observe — it fires only for Chromium children.

## Behaviour Change

"Zero behaviour change" would be overstated, so precisely: there is **no change to IPC contracts, return values, rejection identity, or timing semantics**, and no change to hardware, rendering, or scanning behaviour. Four real deviations are accepted and specified:

1. `crashReporter.start()` installs process-level crash handling and spawns a persistent crash-handler child process, so the production rig's process tree gains one entry.
2. Breadcrumbs cost a measured ~1 ms per synchronous write, ~1.7 ms per risk-listed call, on the thread being diagnosed — bounded by a circuit breaker that disables the path on a degraded disk.
3. An async wrapper adds frames to `error.stack`; messages are preserved, stacks are not byte-identical.
4. CylinderScan mode previously wrote nothing to `~/.bloom/logs/` and now creates a file on every launch.

## Impact

- **Affected specs:** `application-lifecycle` (ADDED: Diagnostics Log Sink, Diagnostics Log Write-Failure Visibility, Diagnostics Log Volume Bounds, Diagnostics Run Identity, Diagnostics Never Record Secrets, Local Crash Report Capture, Main-Process Event-Loop Lag Monitoring, Renderer Responsiveness Logging, Process Loss Logging, Unhandled Main-Process Error Logging, Freeze Indicator Scan Context, Diagnostics Subsystem Toggle); `ipc-reliability` (ADDED: IPC Watchdog Installation, IPC Watchdog Transparency, IPC Watchdog Records No Payloads, Slow IPC Handler Detection, In-Flight IPC Breadcrumbs, In-Flight IPC Registry, Breadcrumb Write Circuit Breaker)
- **Affected code:** `src/main/main.ts` (wiring only — two calls); new `src/main/diagnostics.ts` (wiring seam), `src/main/diagnostics-log.ts`, `src/main/ipc-watchdog.ts`, `src/main/event-loop-probe.ts`, `src/main/process-diagnostics.ts`
- **New tests:** `tests/unit/{diagnostics-log,event-loop-probe,process-diagnostics,ipc-watchdog,diagnostics-wiring}.test.ts`
- **Affected docs:** `docs/TROUBLESHOOTING.md` (reading the log, unmatched breadcrumbs, and "use `kill -9`, not the power button"), `docs/CONFIGURATION.md` (the four env vars, and that they are launch-environment only), `docs/GRAVISCAN_LINUX_DEPLOYMENT.md` (the shell-only caveat on the rig)
- **Production rig safety:** `graviscan-ms-7c56` is AMD/`amdgpu` and shares no exposure to the NVIDIA fault. Nothing here changes rendering, hardware, or IPC behaviour. **But** production runs the same code with five real V600s and the same synchronous `lsusb` call sites on unattended multi-hour sessions, so it **is** exposed to the blocked-main-loop hypothesis this change exists to test — arguably more than the dev rig.
- **Relates to:** #381 (driver, stays open), #383 (GPU segfaults, split out), #375 and #378 (the reachable and dead channels behind the hypothesis), #366, #287, #368 (hangs assessed above), #187 and #86 (prior art on main-loop blocking), #225 and #371 (cycle-overrun and timeout effects the lag probe would help explain), #363 (no in-app log viewer), #348 (rig disk-space monitoring), #325/#284/#204 (the dead-env-var pattern these four variables must not repeat)
