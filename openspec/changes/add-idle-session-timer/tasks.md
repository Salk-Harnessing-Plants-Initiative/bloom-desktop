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
- [x] 3.4 Validate `timeoutMs` in `IdleTimer` constructor (`idle-timer.ts`)
  - [x] 3.4.1 Write failing test: constructor throws on invalid timeoutMs (0, negative, NaN)
  - [x] 3.4.2 Add validation to constructor, throw `RangeError` on invalid values
- [x] 3.5 Clarify "configurable timeout" in spec as programmatic (for testing), not runtime
- [x] 3.6 Add `aria-label` to idle-reset dismiss button (`CaptureScan.tsx`)
  - [x] 3.6.1 Write failing test: dismiss button has accessible name
  - [x] 3.6.2 Add `aria-label="Dismiss idle reset notification"` to button
- [x] 3.7 Add renderer unit tests for idle reset notification (`CaptureScan.tsx`)
  - [x] 3.7.1 Test: idle reset callback clears metadata and shows notification banner
  - [x] 3.7.2 Test: dismiss button hides the notification

## 4. Review Fixes (subagent review feedback)

- [x] 4.1 Strengthen test 3.7.1 to assert metadata fields are actually cleared (`capture-scan-config.test.tsx`)
  - [x] 4.1.1 Write failing assertion: metadata inputs show empty values after idle reset callback
- [x] 4.2 Add unmount/cleanup test for `onIdleReset` useEffect (`capture-scan-config.test.tsx`)
  - [x] 4.2.1 Write failing test: cleanup function is called on unmount; callback after unmount does not show banner
- [x] 4.3 Update notification copy to enumerate all cleared fields (`CaptureScan.tsx`)
  - [x] 4.3.1 Write failing test: banner text mentions wave number, plant age, accession name
  - [x] 4.3.2 Update banner copy to list all five cleared fields
- [x] 4.4 Clear idle-reset banner when user starts next scan (`CaptureScan.tsx`)
  - [x] 4.4.1 Write failing test: banner is hidden when handleStartScan is called
  - [x] 4.4.2 Call `setIdleResetMessage(false)` at start of `handleStartScan`
- [x] 4.5 Reset idle timer on explicit `session:reset` IPC handler (`main.ts`)
  - [x] 4.5.1 No dedicated unit test needed — `session:reset` is a one-line IPC handler; covered by integration
  - [x] 4.5.2 Call `idleTimer.stop()` in `session:reset` handler
- [x] 4.6 Fix `onIdleReset` preload listener to match `_event: unknown` pattern (`preload.ts`)
  - [x] 4.6.1 No dedicated test needed — pattern consistency fix, existing tests verify behaviour
  - [x] 4.6.2 Update `const listener = () => callback()` to `const listener = (_event: unknown) => callback()`

## 5. Regression Fixes (second Copilot review)

- [x] 5.1 Fix: `session:reset` calling `idleTimer.stop()` permanently disables idle feature (`main.ts`)
  - [x] 5.1.1 Write failing test: after `session:reset`, subsequent activity restarts timer and it fires
  - [x] 5.1.2 Remove `idleTimer.stop()` from `session:reset` — rely on `hasSessionData()` guard
- [x] 5.2 Strengthen test 4.4.1: banner cleared on scan start must not rely on fallback branch
  - [x] 5.2.1 Write failing test: after idle reset, re-fill all fields, start scan, assert banner gone
- [x] 5.3 Rename `idleResetMessage` → `showIdleResetBanner` for clarity (`CaptureScan.tsx`)
  - [x] 5.3.1 Write failing test: assert existing tests still pass after rename (refactor coverage)
  - [x] 5.3.2 Rename state variable and all references
