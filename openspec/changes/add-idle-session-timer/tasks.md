## 1. Tests

- [x] 1.1 Write unit tests for idle timer module (`tests/unit/idle-timer.test.ts`)
  - [x] 1.1.1 Timer starts on first activity event
  - [x] 1.1.2 Timer resets when `session:set` is called (phenotyper/experiment change)
  - [x] 1.1.3 Timer resets when `scanner:initialize` is called
  - [x] 1.1.4 Timer fires callback after configured timeout with no activity
  - [x] 1.1.5 Timer does NOT fire during an active scan (`scanner:scan` in progress)
  - [x] 1.1.6 Timer resumes after scan completes
  - [x] 1.1.7 Timer does NOT reset on non-activity events (page navigation, polling)
  - [x] 1.1.8 Configurable timeout duration (default 10 minutes)
  - [x] 1.1.9 Timer can be stopped and restarted (cleanup on app quit)
  - [x] 1.1.10 Multiple rapid activity events only create one timer (debounce/reset)
- [x] 1.2 Write unit tests for session store idle reset integration (`tests/unit/session-store.test.ts`)
  - [x] 1.2.1 `resetSessionState()` clears all fields to null on idle
  - [x] 1.2.2 Session state is fully reset (phenotyperId, experimentId, waveNumber, plantAgeDays, accessionName)
- [ ] 1.3 Write E2E test for idle reset notification (`tests/e2e/`)
  - [ ] 1.3.1 After idle timeout, user sees a visible notification that session was reset
  - [ ] 1.3.2 After idle reset, phenotyper and experiment dropdowns show placeholder/empty state

## 2. Implementation

- [x] 2.1 Create idle timer module (`src/main/idle-timer.ts`)
  - [x] 2.1.1 Export `IdleTimer` class with `start()`, `stop()`, `resetTimer()`, `pauseForScan()`, `resumeAfterScan()` methods
  - [x] 2.1.2 Accept configurable timeout (default: 10 minutes = 600000ms)
  - [x] 2.1.3 Accept `onIdle` callback that fires when timeout expires
- [x] 2.2 Wire idle timer into main process IPC handlers (`src/main/main.ts`)
  - [x] 2.2.1 Create `IdleTimer` instance on app ready
  - [x] 2.2.2 Reset timer in `session:set` handler
  - [x] 2.2.3 Reset timer in `scanner:initialize` handler
  - [x] 2.2.4 Pause timer when `scanner:scan` starts
  - [x] 2.2.5 Resume timer when scan completes or errors
  - [x] 2.2.6 On idle callback: call `resetSessionState()` and send `session:idle-reset` to renderer
  - [x] 2.2.7 Stop timer on app `before-quit`
- [x] 2.3 Expose `session:idle-reset` event in preload (`src/main/preload.ts`)
  - [x] 2.3.1 Add `onIdleReset` listener to session API
- [x] 2.4 Update type definitions (`src/types/electron.d.ts`)
  - [x] 2.4.1 Add `onIdleReset: (callback: () => void) => () => void` to `SessionAPI`
- [x] 2.5 Handle idle reset in renderer (`src/renderer/CaptureScan.tsx`)
  - [x] 2.5.1 Listen for `session:idle-reset` event on mount
  - [x] 2.5.2 Clear metadata state (phenotyper, experiment, wave, age, accession)
  - [x] 2.5.3 Show visible notification/toast to user that session was reset due to inactivity
  - [x] 2.5.4 Clean up listener on unmount

## 3. Bug Fixes (review feedback)

- [x] 3.1 `resumeAfterScan()` must be no-op when timer was not paused (`idle-timer.ts`)
  - [x] 3.1.1 Write failing test: `resumeAfterScan` without prior `pauseForScan` must not reset countdown
  - [x] 3.1.2 Guard `resumeAfterScan()` to return early when `!this.paused`
- [x] 3.2 Move `pauseForScan()` before scanner null-check in `scanner:scan` handler (`main.ts`)
- [x] 3.3 Fix `tasks.md` doc: `onIdleReset` return type is `() => void`, not `void`
