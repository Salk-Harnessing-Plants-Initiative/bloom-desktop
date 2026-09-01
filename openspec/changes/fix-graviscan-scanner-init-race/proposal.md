## Why

A restart-after-failed-run leaves duplicate scan-worker processes per scanner and hangs Capture Scan (#350): `ScanCoordinator.initialize()`/`addScanner()` have no guard against two overlapping calls racing on the same `scannerId`, so a healthy worker that is still mid-`sane.open()` (~30s) gets misdiagnosed as dead and respawned, and the 5s `shutdown()` budget can't reclaim a worker blocked in a libusb call, so both survive. Separately, `initialize()` also spawns all scanners sequentially, costing ~5 minutes of startup with 4 scanners instead of ~30s (#144). Both bugs live in the exact same spawn path, and #144's parallelization would reshape rather than fix #350's race if applied alone — the re-entrancy guard is what makes parallelizing that path safe. Ship them together.

## What Changes

- Add a per-`scannerId` in-flight-spawn guard at `ScanCoordinator`'s shared private spawn path (used by both `initialize()` and `addScanner()`), so a second caller for the same `scannerId` awaits the call already in flight instead of independently deciding to respawn.
- Make `ScannerSubprocess.shutdown()` honest: after the graceful-quit timeout, force-kill and then wait a further bounded window for the process's actual `exit` event before treating the slot as freed; if that still can't be confirmed, communicate "unconfirmed" to the caller instead of silently resolving as if it succeeded. Apply the same honesty to `initialize()`'s stale-subprocess cleanup, which has the identical latent bug.
- When a spawn attempt can't confirm readiness within a bounded timeout and a reclaim attempt can't confirm the process exited, report that scanner as failed for this init cycle via the existing `initErrors`/`scanner-init-status` channel — **do not** spawn a duplicate. No new user-facing copy or messaging surface.
- Parallelize `initialize()`'s per-scanner spawn loop via `Promise.allSettled`, now safe because the guard above makes concurrent per-scanner spawns non-racing; one scanner's failure must not block the others; the existing 5s USB stagger in `scanOnce()` is untouched.
- Update `openspec/specs/scanning/spec.md` to reflect parallel (not sequential) initialization, the shared spawn-concurrency guard, and honest/confirmed shutdown semantics; reconcile the spec's `initializing` wording with the code's actual `starting` state name.

## Impact

- Affected specs: `scanning` (ScanCoordinator Multi-Scanner Orchestration, Coordinator Single-Scanner Spawn API, ScannerSubprocess Worker Management requirements)
- Affected code: `src/main/graviscan/scan-coordinator.ts` (`initialize()`, `spawnSingleScanner()`, `hasWorker()`), `src/main/graviscan/scanner-subprocess.ts` (`shutdown()`)
- Not affected: call sites (`src/main/graviscan/scanner-handlers.ts`, `src/main/graviscan/session-handlers.ts`) — both already `await coordinator.initialize(...)`; no change needed at the call-site level
- Not affected: any renderer/UI code — this is backend-only
- Out of scope: #182 (stale USB device address after reconnect), #167 (duplicate DB records), #125 (true hardware-wedge recovery — this change only stops misdiagnosing a healthy-but-connecting worker as failed; it does not and cannot recover a genuinely wedged scanner, which per #125's documented history requires a physical AC power-cycle)
