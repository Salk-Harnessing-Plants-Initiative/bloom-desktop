## Why

In a shared lab environment, if a phenotyper walks away without logging out, the next person's scans get attributed to the wrong phenotyper. Bloom Desktop has no idle detection, so session state (phenotyper and experiment selections) persists indefinitely.

## What Changes

- Add an idle timer in the main process that tracks inactivity based on scanning-related IPC events
- Reset session state (phenotyper, experiment, wave number, plant age, accession) when idle timeout expires
- Fire a `session:idle-reset` event to the renderer so the UI clears selections and notifies the user
- Make the timeout duration configurable (default: 10 minutes)
- Ensure the timer does NOT fire during active scans

## Impact

- Affected specs: scanning
- Affected code: `src/main/idle-timer.ts` (new idle timer module), `src/main/session-store.ts` (provides `resetSessionState()`), `src/main/main.ts` (IPC handler wiring), `src/main/preload.ts` (expose idle-reset event), `src/types/electron.d.ts` (type updates), `src/renderer/CaptureScan.tsx` (idle reset handler and user notification)
