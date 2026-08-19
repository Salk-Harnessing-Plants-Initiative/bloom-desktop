## 1. #333 — Fix stale default `bloom_api_url`

- [x] 1.1 **Test (red)**: update `tests/unit/config-store.test.ts:310`'s assertion
      (`getDefaultConfig` describe block) to
      `expect(defaults.bloom_api_url).toBe('https://bloom.salk.edu/api')`.
      Run it and confirm it fails against current code.
- [x] 1.2 **Implement (green)**: update the `bloom_api_url` default in
      `getDefaultConfig()` (`src/main/config-store.ts:155`) to
      `'https://bloom.salk.edu/api'`. Confirm 1.1 now passes.
- [x] 1.3 **Test (red)**: `tests/unit/pages/MachineConfiguration.test.tsx`'s
      existing `getByDisplayValue('https://api.bloom.salk.edu/proxy')`
      assertion (~line 134) lives inside the "pre-fill form with saved
      values" test, whose mock simulates an _existing_ saved config — that
      test is unrelated to the hardcoded default and must keep asserting
      the value its own mock provides (leave it alone, or update its mock's
      `bloom_api_url` fixture to the new URL if the intent is also to
      harmonize that fixture — either way, do not treat changing this
      assertion as fixing the default). The hardcoded default in
      `MachineConfiguration.tsx` only actually renders when
      `config.get()` **rejects** (the `catch` branch of `loadConfiguration()`,
      which sets form state without calling `setConfig`) — no test exercises
      this today. Add a new test: mock
      `mockConfigAPI.get.mockRejectedValue(new Error('...'))` and assert the
      rendered `bloom_api_url` input's value is the new default. Confirm it
      fails against current code (still shows the old proxy URL).
- [x] 1.4 **Implement (green)**: update `MachineConfiguration.tsx`'s local
      `useState` initial config (~line 35) and the `bloom_api_url` input's
      placeholder text (~line 302) to the new URL. Confirm 1.3's new test
      now passes.
- [x] 1.5 **Non-test references**: update `.env.example`,
      `docs/MANUAL_UPLOAD_TESTING.md` (both the example `.env` snippet and
      the prose "default" mention), `scripts/examples/test-bloom-api.example.js`,
      and the fallback value in `tests/e2e/machine-config-fetch-scanners.e2e.ts`.
      Leave archived `openspec/changes/archive/**` files and the ~35 arbitrary
      fixture-value occurrences across other unit tests untouched (they use
      the string as an arbitrary valid-URL fixture, not an assertion on the
      default).
- [x] 1.6 Run `/lint`, `npx tsc --noEmit`, and the targeted test files from
      1.1/1.3; confirm green.

## 2. #334 — Restart-required notice when `scanner_mode` changes

- [x] 2.1 **Test (red)**: in `tests/unit/pages/MachineConfigMode.test.tsx`, add:
      (a) changing the Scanner Mode radio and saving successfully shows a
      persistent "restart required" notice; (b) changing a non-mode field
      (e.g. `scans_dir`) and saving successfully shows the existing generic
      toast but NOT the restart-required notice; (c) using fake timers,
      advance time past the existing 3-second auto-dismiss window
      (`MachineConfiguration.tsx:129`) after a mode-change save, and assert
      the restart-required notice is STILL visible (unlike the generic
      toast, which clears); (d) clicking the notice's dismiss control
      removes it. Confirm all four fail against current code (no such
      notice exists yet).
- [x] 2.2 **Implement (green)**: in `MachineConfiguration.tsx`'s `handleSave`,
      compare the submitted `scanner_mode` against `originalConfig.scanner_mode`
      before calling `setOriginalConfig`; when they differ, render a
      persistent, non-auto-dismissing, dismissible notice (a new local
      element modeled on the `sticky top-0` / no-auto-dismiss-timer pattern
      used by `src/renderer/components/WedgeBanner.tsx` — do NOT import or
      reuse `WedgeBanner` itself, since it is tightly coupled to GraviScan
      wedge-event data and is unrelated to this notice) stating a restart is
      required, instead of relying solely on the 3-second toast. Confirm
      2.1's four cases all pass.
- [x] 2.3 Run `/lint`, `npx tsc --noEmit`, and
      `tests/unit/pages/MachineConfigMode.test.tsx`; confirm green.

## 3. #336 — Surface `exportedScans` in Export's success/partial messages

- [x] 3.1 **Test (red)**: update the two message-text assertions in
      `tests/unit/components/Export.test.tsx` (~line 227 partial-failure
      case, ~line 318 plain-success case) to expect the new format, e.g.
      `'12 scans exported (73 files), 0 files skipped (already exist)'`
      using each test's existing `exportedScans` mock value. Confirm both
      fail against current code.
- [x] 3.2 **Implement (green)**: add `exportedScans: number` to both the
      `success` and `partial` variants of `Export.tsx`'s local `ResultBanner`
      type (~lines 9-17); populate it from `data.exportedScans` in both
      `setResultBanner` calls in `handleExport` (~lines 246-260); update the
      rendered message (~lines 327-330) to the new labeled format,
      including correct singular/plural wording for the `1 scan exported (1
file)` case. No backend changes (`scansExport()` already returns
      `exportedScans` correctly). Confirm 3.1 now passes.
- [x] 3.3 Run `/lint`, `npx tsc --noEmit`, and
      `tests/unit/components/Export.test.tsx`; confirm green.

## 4. #338 + #339 — Machine Configuration Hardware section: camera detection + hardware diagnostics

These two land in the same section of the same file (see design.md), so
tests are written first for the full target shape of that section, then
implemented together to avoid two uncoordinated passes over the same JSX.
Steps 4.2/4.4 deliberately **duplicate before removing** (not a single
"move"), so the test suite never has to pass through a red window where
neither file has the logic.

- [x] 4.1 **Test (red)**: in `tests/unit/pages/MachineConfiguration.test.tsx`,
      add cases for:
      (a) the Hardware section calls `camera:detect-cameras` on mount and
      renders a dropdown of detected cameras, and the mock camera entry is
      always present in that dropdown regardless of what's detected;
      (b) selecting a detected camera sets `camera_ip_address` to its IP,
      and the existing "Test Connection" action still targets that value;
      (c) choosing "Manual Entry..." reveals a free-text input that still
      saves via `config.set` as before;
      (d) zero cameras detected (an empty resolved list) falls back to
      manual entry;
      (e) a **rejected** `camera:detect-cameras` promise (distinct from an
      empty list) also falls back to manual entry without throwing;
      (f) `camera_ip_address` already saved as a real IP not present in the
      detected list pre-fills the manual entry field with that saved value,
      not blank and not the mock default;
      (g) `camera_ip_address` already saved and matching a detected camera
      pre-selects that camera in the dropdown;
      (h) a "Check Hardware" button invokes `python:check-hardware` and
      displays the result;
      (i) a "Restart Python" button calls `window.confirm(...)` before
      acting, and only calls `python:restart` if the mocked `confirm`
      returns `true` — mocking `confirm` to return `false` asserts
      `python:restart` is NOT called (matching the `window.confirm()`
      pattern already used in `tests/unit/components/Export.test.tsx`).
      Confirm all fail against current code.
- [x] 4.2 **Implement (green), duplicate first**: copy the camera-selection/
      detection/manual-entry/help-text JSX and state (`detectedCameras`,
      `isDetecting`, `selectedCamera`, `showManualEntry`, `showHelp`, and the
      mount effect) from `CameraSettingsForm.tsx` (~lines 46-232) into
      `MachineConfiguration.tsx`'s existing Hardware section, replacing its
      plain `camera_ip_address` text input — but adapted, not pasted
      verbatim: drop the `config.get()` pre-fetch step (Machine
      Configuration already holds the canonical `camera_ip_address` in its
      own `config` state, so re-fetching it would be redundant), replace the
      `onChangeRef`/`settingsRef` callback-prop pattern with a direct
      `setConfig((prev) => ({...prev, camera_ip_address: ...}))` call, and
      add the `DetectedCamera` type import from `../types/camera`. Add
      "Check Hardware" / "Restart Python" controls to the same section,
      wired to the existing `window.electron.python.checkHardware()` /
      `restart()` calls, gating the restart call behind a `window.confirm()`
      call. At this point the camera-selection logic exists in BOTH files.
      Confirm 4.1's cases (a)-(i) all pass.
- [x] 4.3 **Verify (no new tests needed)**: confirm all six existing
      `tests/unit/components/CameraSettingsForm.test.tsx` cases and the four
      `tests/unit/pages/CameraSettings.test.tsx` cases still pass with the
      duplicated logic in place (they already exercise
      `showCameraSelection={false}` or don't assert on the selection UI, per
      exploration, so this step is confirming the pre-removal state is
      still green before the next step removes the original).
- [x] 4.4 **Test (red) then implement (green), remove the original**: add a
      regression test to `tests/unit/pages/CameraSettings.test.tsx`
      asserting the camera-selection UI is NOT present (e.g.
      `expect(screen.queryByText(/Detect Cameras/i)).not.toBeInTheDocument()`
      or equivalent query for the dropdown/manual-entry controls) — confirm
      it fails while the duplicate still exists in `CameraSettingsForm.tsx`.
      Then remove the camera-selection/manual-entry/help-text block and its
      `showCameraSelection` prop path from `CameraSettingsForm.tsx`; update
      `CameraSettings.tsx` to stop passing `showCameraSelection={true}`;
      trim the now-unused `detectCameras`/`config.get` mocks in
      `CameraSettings.test.tsx` if they no longer serve a purpose. Confirm
      `CaptureScan.tsx`'s `readOnly` usage of `CameraSettingsForm` is
      unaffected (it already skips this code path). Confirm the new
      regression test now passes, and re-confirm 4.3's existing tests are
      still green.
- [x] 4.5 **Test, deliberate exception to strict red-first ordering**: in
      `tests/unit/pages/MachineConfigMode.test.tsx`, add a case asserting
      the Hardware Diagnostics controls (Check Hardware / Restart Python)
      are not rendered when `scanner_mode` is `graviscan`, alongside the
      existing camera-IP-field mode-gating assertions in that file. This is
      the one task in this file that isn't written strictly before its
      implementation: "the controls are absent in graviscan mode" is only a
      meaningful, non-vacuous assertion once the controls exist at all (in
      cylinderscan mode) to be conditionally gated — write it alongside 4.2
      rather than before it, and confirm it passes once 4.2 lands the
      mode-gated controls.
- [x] 4.6 **Test (red)**: in `tests/unit/components/PythonStatus.test.tsx`,
      all five tests keyed off the "Check Hardware"/"Restart Python" buttons
      need rewriting, not just the two double-click-guard/failed-restart
      cases:
      (a) the double-click-guard test,
      (b) the failed-restart test,
      (c) the `bg-lime-700`/`hover:bg-lime-800` "Check Hardware" color-palette
      test — delete it (the button no longer exists on this component),
      (d) the "shows Contact your administrator when camera library
      unavailable" test — rewrite its trigger mechanism: since `hardware`
      state and the `checkHardware` button are both gone, drive the failure
      state through the mocked `onStatus`/`onError` callback (the same
      capture pattern already used by this file's cleanup tests) so it sets
      status to `'Error'`, then assert the new _generic_ "Contact your
      administrator" message appears (not the old per-camera/per-DAQ
      specific text, which no longer exists),
      (e) the "never links to Machine Configuration" test — same
      retrigger-via-`onError`/`onStatus` change, keep the core assertion.
      Additionally add: a test asserting `window.electron.python.checkHardware`
      and `window.electron.python.restart` are never called by this
      component after mount (the acceptance criterion from the modified
      `ui-management-pages` spec). Confirm all fail/need-rewrite against
      current code.
- [x] 4.7 **Implement (green)**: simplify `PythonStatus.tsx` to render only
      the status indicator derived from existing `getVersion`/`onStatus`/
      `onError` state, relabeled to three states — Connected (status is
      `'Connected'` or contains `'ready'`), Error (status is `'Error'`), and
      Checking (everything else, including the initial `'Checking...'` and
      `'Restarted'`) — remove the "Check Hardware"/"Restart Python" buttons,
      the `isRestarting` state, the `restartPython`/`checkHardware`
      handlers, and the detailed camera/DAQ breakdown block. On Error,
      render a single generic "Contact your administrator" message in place
      of the existing raw `{error && <div>{error}</div>}` block (~lines
      190-195) — replace that block's content rather than keeping both the
      generic message and the raw internal error string rendered side by
      side. Preserve the existing `mode !== 'cylinderscan'`
      gating (both the effect-level and render-level checks). Confirm 4.6
      passes.
- [x] 4.8 Run `/lint`, `npx tsc --noEmit`, and the five touched test files
      (`MachineConfiguration.test.tsx`, `MachineConfigMode.test.tsx`,
      `CameraSettingsForm.test.tsx`, `CameraSettings.test.tsx`,
      `PythonStatus.test.tsx`); confirm green.

## 5. Documentation note (no code)

- [x] 5.1 Add one sentence to `docs/CONFIGURATION.md` noting that Machine
      Configuration is reachable via `Ctrl+Shift+,` (`Cmd+Shift+,` on
      macOS) with no visible sidebar link, and that admins should relay this
      shortcut to lab technicians who may need to report hardware issues
      now that Check Hardware/Restart Python live there instead of on Home.
- [x] 5.2 Leave a comment on GitHub issue #335 noting that its subject help
      text (Basler camera IP-finding instructions) has relocated from the
      Camera Settings page into Machine Configuration as part of this
      change, so its "on Camera Settings page" framing doesn't go stale.

## 6. Spec sync and final verification

- [x] 6.1 Run `openspec validate fix-cylinderscan-config-ux-quickfixes --strict`
      and resolve any issues.
- [x] 6.2 Run the full targeted unit/component test suite for every file
      touched above (`/test`), `npx tsc --noEmit`, and `/lint`; confirm all
      green.
- [x] 6.3 Manually smoke-test in the running app (`/dev` or `/run`): change
      Scanner Mode and confirm the restart notice appears and survives past
      3 seconds until dismissed; verify camera detection (including
      previously-saved-IP pre-selection/pre-fill) and manual entry, and
      Check Hardware/Restart Python (with confirm dialog) in Machine
      Configuration; confirm Camera Settings no longer shows camera
      selection; confirm Home shows only the simplified status indicator
      with a generic admin-contact message on error; run an export and
      confirm the new scan-count message, including the singular `1 scan
exported (1 file)` case.
- [x] 6.4 **Found and fixed during 6.3**: `src/main/main.ts`'s real
      `config:get` IPC handler omitted `scanner_mode` from its returned
      config object entirely — invisible to every unit test covering
      `MachineConfiguration.tsx` because those mock `config.get()` directly
      with a hand-built response that always included the field; only the
      real IPC round-trip exercised by manual E2E testing caught it. Net
      effect in the real app: the Scanner Mode radios always rendered
      unchecked and the entire CylinderScan-only Hardware section — camera
      IP, and now this change's Check Hardware/Restart Python/camera
      detection — never rendered, regardless of what was actually saved.
      Fixed by adding the missing field to the handler's return statement;
      verified red→green by reverting the one-line fix and re-running the
      new regression test below, confirming it fails without the fix.
      Added `tests/e2e/machine-config-scanner-mode-persistence.e2e.ts` as a
      permanent regression test, since this class of bug (a field silently
      dropped by the real main-process handler) is structurally invisible
      to unit tests that mock the IPC boundary — only a real IPC round-trip
      can catch it. Also corrected the pre-existing
      `tests/unit/config-ipc.test.ts` "1.2.1" test, which independently
      duplicated the handler's field list and had drifted out of sync with
      it (hardcoding `scanner_mode: 'cylinderscan'` rather than deriving it
      from the loaded config, silently masking the exact gap it should
      have caught).
