## Why

A manual walkthrough of PR #329 (Tier 4 style/UX parity) surfaced six small,
independent, pre-existing UX/config gaps — unrelated to what Tier 4 changed,
just noticed while exercising the app in CylinderScan mode. Five are small
enough, and touch closely-related surfaces (Machine Configuration, Camera
Settings, Home, Export) closely enough, to bundle into one cohesive
"config/UX quick fixes" change rather than five separate proposals.

## What Changes

- **#333** — Fix the stale default `bloom_api_url`
  (`https://api.bloom.salk.edu/proxy` → `https://bloom.salk.edu/api`) in
  `getDefaultConfig()` (`src/main/config-store.ts`). Exploration also found a
  second, independent hardcoded copy of the same stale default in
  `MachineConfiguration.tsx`'s local `useState` initializer plus a stale
  placeholder string — both are fixed so the value can't drift out of sync
  again. Also updates `.env.example`, `docs/MANUAL_UPLOAD_TESTING.md`,
  `scripts/examples/test-bloom-api.example.js`, and the live
  `machine-configuration` spec's own scenario text.
- **#334** — When Machine Configuration is saved and `scanner_mode` changed,
  show a persistent "restart required" notice (reusing the existing
  `WedgeBanner` sticky/dismissible idiom) instead of the generic
  auto-dismissing "Configuration saved successfully!" toast. Confirmed via
  investigation that `scanner_mode` is the _only_ Machine Config field with
  this bug today — every other field is re-read fresh from disk on its next
  relevant use, not cached for the app process's lifetime — so this is a
  complete fix, not a partial one. (Two related manual-`.env`-only fields
  with the same underlying root cause are out of scope — see
  [Deferred Scope](#deferred-scope) below.)
- **#336** — Export page's success/partial banners now surface the
  backend's already-computed `exportedScans` count alongside the file count,
  e.g. "12 scans exported (73 files), 0 files skipped (already exist)",
  instead of the ambiguous "73 exported, 0 skipped" that never says what
  "73" counts. No backend change — `scansExport()` already returns
  `exportedScans`.
- **#338** — Remove the camera-selection/manual-entry/auto-detection UI from
  the Camera Settings page (`CameraSettingsForm`'s `showCameraSelection`
  block) and move camera auto-detection into Machine Configuration's
  Hardware section, replacing its plain `camera_ip_address` text input with
  the dropdown + manual-entry UI. Machine Configuration becomes the sole
  place `camera_ip_address` is set. The detection IPC path
  (`camera:detect-cameras`) is already decoupled from `CameraSettingsForm`'s
  rendering, so this is a UI-only relocation.
- **#339** — Move "Check Hardware" / "Restart Python" from the Home page's
  `PythonStatus` into Machine Configuration's Hardware section (alongside
  #338's camera controls), adding a confirm dialog before restart ("Restart
  Python? This may interrupt an in-progress scan.") since no guard against
  restarting mid-scan exists today. Home's `PythonStatus` keeps only a
  simple status indicator (connected/disconnected/error) — no interactive
  controls, no link to Machine Configuration (preserving the existing,
  intentional #104-era decoupling).
- **Bug fix found during manual smoke-testing (task 6.3)** — the real
  `config:get` IPC handler (`src/main/main.ts`) silently omitted
  `scanner_mode` from its returned config object. Every unit test covering
  `MachineConfiguration.tsx` mocks `config.get()` directly and always
  included the field, so this was invisible until a real IPC round-trip:
  in the actual app, the Scanner Mode radios always rendered unchecked and
  the whole CylinderScan-only Hardware section — including this change's
  new camera detection and Hardware Diagnostics UI — never rendered,
  regardless of what was actually saved. Fixed in-scope since it directly
  blocked #338/#339's own new UI from ever appearing; added a permanent E2E
  regression test (`tests/e2e/machine-config-scanner-mode-persistence.e2e.ts`)
  since this class of bug is structurally invisible to IPC-mocking unit
  tests.

### Deferred Scope

- **#337** (sidebar nav ordering in `Layout.tsx`) is explicitly deferred.
  PRs #289 and #290 are both still open (confirmed via
  `gh pr view 289/290 --json state,mergedAt`, both `mergedAt: null`) and are
  actively rewriting `Layout.tsx` (mode-based route gating, new nav links).
  This is the same collision Tier 4 deliberately avoided by leaving
  `Layout.tsx` untouched (see that change's own Deferred Scope precedent).
  Revisit once #289/#290 land.
- Adding Machine Configuration UI for the three manual-`.env`-only fields
  (`graviscan_system_name`, `slack_webhook_url`, `libusb_endpoint_recovery`)
  that share #334's root cause is tracked separately in follow-up issue
  [#343](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/343)
  — it's a new-UI feature (new form fields, new validation, new save-path
  plumbing), not a quick fix, and none of these fields have a save path
  today for a restart notice to attach to.
- Tier 5b (hardware/packaging QA) and the other deferred walkthrough items
  (#42/#44/#51 camera settings persistence/presets, #341 Box upload, #340
  metadata research) are unrelated to this pass.
- **#335** ("Verify accuracy of Basler camera IP-finding instructions") is
  about the exact help-text block that #338's relocation moves verbatim
  from `CameraSettingsForm.tsx` into `MachineConfiguration.tsx`. This
  proposal does not verify or change that text's accuracy — it requires
  physical Basler hardware access, out of scope here for the same reason as
  Tier 5b. A comment will be left on #335 noting the relocation so its
  "on Camera Settings page" framing doesn't go stale.

## Impact

- Affected specs: `machine-configuration`, `scan-export`, `ui-management-pages`
- Affected code:
  - `src/main/config-store.ts` (default config)
  - `src/renderer/MachineConfiguration.tsx` (default/placeholder, restart
    notice, relocated camera detection + hardware diagnostics)
  - `src/renderer/Export.tsx` (success/partial banner text + `ResultBanner`
    type)
  - `src/components/CameraSettingsForm.tsx` (remove camera-selection block)
  - `src/renderer/CameraSettings.tsx` (drops `showCameraSelection` usage)
  - `src/renderer/components/PythonStatus.tsx` (simplify to status-only on
    Home; relocated buttons live in Machine Configuration)
  - `src/renderer/Home.tsx` (unaffected wiring, simplified child component)
  - `src/main/main.ts` (`config:get` handler — added missing `scanner_mode`
    field, found via manual smoke-testing; see What Changes)
  - `.env.example`, `docs/MANUAL_UPLOAD_TESTING.md`,
    `scripts/examples/test-bloom-api.example.js`
  - `docs/CONFIGURATION.md` (one-sentence admin note about the
    `Ctrl+Shift+,` Machine Configuration shortcut, added per user request
    during review — documentation only, no behavior change)
  - Tests: `tests/unit/config-store.test.ts`,
    `tests/unit/components/Export.test.tsx`,
    `tests/unit/pages/MachineConfiguration.test.tsx`,
    `tests/unit/pages/MachineConfigMode.test.tsx`,
    `tests/unit/components/PythonStatus.test.tsx`,
    `tests/unit/components/CameraSettingsForm.test.tsx`,
    `tests/unit/pages/CameraSettings.test.tsx`,
    `tests/unit/config-ipc.test.ts` (corrected drifted `scanner_mode`
    simulation),
    `tests/e2e/machine-config-fetch-scanners.e2e.ts` (stale-URL fallback
    value),
    `tests/e2e/machine-config-scanner-mode-persistence.e2e.ts` (new
    permanent regression test)
