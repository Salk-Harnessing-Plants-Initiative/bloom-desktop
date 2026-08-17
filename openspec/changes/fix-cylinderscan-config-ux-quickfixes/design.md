## Context

Five independent, pre-existing UX/config gaps in CylinderScan mode's
configuration surfaces, all filed as separate GitHub issues (#333, #334,
#336, #338, #339) after a manual walkthrough of PR #329. Two of them (#338,
#339) converge on the same section of the same file
(`MachineConfiguration.tsx`'s Hardware section), so this design covers that
convergence explicitly rather than treating them as fully independent edits.

## Goals / Non-Goals

- Goals:
  - Fix each of the five issues completely within its own stated scope.
  - Make Machine Configuration the single source of truth for
    `camera_ip_address`, without losing the auto-detection capability.
  - Give the admin (who now owns hardware troubleshooting) a safety net
    before restarting Python mid-scan, without building new cross-cutting
    scan-state-tracking infrastructure.
- Non-Goals:
  - Building a live-reload architecture so `scanner_mode` changes apply
    without any restart (explicitly called out as a bigger, separate
    follow-up in #334 itself).
  - Adding Machine Config UI for the three manual-`.env`-only fields
    (tracked in #343).
  - Touching `Layout.tsx` sidebar ordering (#337, deferred).
  - Building real session/scan-state detection for the Python restart guard
    (a confirm dialog is the agreed-on scope; see Decisions below).

## Decisions

- **Decision: `scanner_mode` is the only field #334's restart-notice covers.**
  Investigated whether other Machine Config fields share the same bug.
  `bloom_api_url`/credentials are re-read from disk on every upload attempt
  (`graviscan-upload.ts`, `image-uploader.ts`); `camera_ip_address` is looked
  up on-demand at camera-connect time; `scanner_name`/`scans_dir`/
  `num_frames`/`seconds_per_rot` are fetched by `CaptureScan.tsx` on its own
  mount, so navigating away and back already refreshes them. Only
  `scanner_mode`, cached once for the app's lifetime via `useAppMode()` at
  `App.tsx`'s root, actually needs a restart. This is a completeness
  discovery, not a scope-narrowing compromise — the fix already covers every
  field that has the bug.
  - Alternatives considered: extending the same notice to the three
    manual-`.env`-only fields — rejected because they have no Machine
    Config UI to attach a save-time notice to; that's a separate feature,
    tracked in #343.

- **Decision: Move camera auto-detection into Machine Configuration
  (#338), rather than dropping it.**
  `camera:detect-cameras` → `CameraProcess.detectCameras()` → Python Pylon
  `EnumerateDevices()` is a generic IPC call with no dependency on
  `CameraSettingsForm`'s rendering — it's already reusable from any
  component. Preserves the convenience of not needing to know the camera's
  IP in advance, at the cost of a moderate (but self-contained) UI change:
  the dropdown + "Manual Entry..." fallback + help text move from
  `CameraSettingsForm.tsx` into `MachineConfiguration.tsx`'s existing
  Hardware section, replacing the plain text input.
  - Alternatives considered: dropping detection entirely and keeping only
    the plain text input — rejected as a capability regression with no
    offsetting benefit, since relocation was already straightforward.
  - Note: `CameraSettingsForm.tsx`'s detection effect currently pre-fetches
    `config.get()` before detecting, purely because that component doesn't
    otherwise know the machine's configured `camera_ip_address` (it operates
    on a separate per-session `CameraSettings` prop shape). Once this logic
    lives in `MachineConfiguration.tsx`, `config.camera_ip_address` is
    already the loaded, canonical value — that pre-fetch step is dropped,
    not carried over, and the state-update pattern changes from the
    `onChangeRef`/`settingsRef` callback-prop machinery to a direct
    `setConfig((prev) => ...)` call, since the state now lives locally
    rather than being owned by a parent via props. This is a rewrite
    informed by the original logic, not a literal cut-and-paste.
  - Note: `MachineConfiguration.tsx`'s Hardware section running
    `camera:detect-cameras` on mount is not a new behavior pattern — the
    Camera Settings page already does exactly this today via
    `CameraSettingsForm`'s own mount effect. This relocates where that
    on-mount detection call happens; it doesn't introduce a new kind of
    interaction with the shared `cameraProcess` singleton in `main.ts` that
    didn't already exist. As before, an admin opening this page while a scan
    is actively using the camera could still send an unsolicited detect
    command to the same subprocess — this pre-existing characteristic is
    unchanged by the relocation and is not a new risk this proposal
    introduces, so no additional guard is added here.

- **Decision: #338 and #339 both land in Machine Configuration's existing
  Hardware section**, since that section is already CylinderScan-gated
  (`config.scanner_mode === 'cylinderscan'`) and already houses the one
  hardware-adjacent field (`camera_ip_address`). Camera detection UI and the
  Check Hardware / Restart Python controls are sequenced as one section
  update rather than two uncoordinated edits to avoid layout thrash across
  two tasks touching the same JSX region.

- **Decision: confirm-dialog-only guard for Restart Python (#339)**, not a
  session/active-scan check. No guard against restarting mid-scan exists
  anywhere in the code today (`PythonProcess.restart()` in
  `src/main/python-process.ts` immediately kills the subprocess and rejects
  all in-flight requests). Adding real scan-state detection would require
  new cross-cutting session-store queries beyond what either #338 or #339
  asked for. A confirm dialog ("Restart Python? This may interrupt an
  in-progress scan.") addresses the safety concern within this PR's scope;
  a stronger guard can be a future issue if it proves necessary in practice.
  - The confirm dialog SHALL be implemented as a plain `window.confirm()`
    call, not Electron's main-process `dialog.showMessageBoxSync`. This
    keeps it renderer-only (consistent across Windows/macOS/Linux with no
    IPC round-trip) and directly testable via `vi.spyOn(window, 'confirm')`
    — the same pattern `tests/unit/components/Export.test.tsx` already uses
    for its own destination-directory confirm dialog.

- **Decision: Home's simplified `PythonStatus` shows a generic, not
  per-component, failure message.** The component's current "Contact your
  administrator" text only exists inside the camera/DAQ detail block that
  the (now-removed) "Check Hardware" button populates — there is no other
  code path that has ever set it. Since Home is losing that button (and, per
  the acceptance criteria, must not silently start auto-invoking
  `python:check-hardware` on mount as a substitute — that would reintroduce
  the very IPC surface #339 is trying to move out of Home), the granular
  per-component message cannot survive on Home in its current form. The
  fix: reinterpret "hardware component unavailable" as "the existing
  Connected/Checking/Error status reports Error" — Home shows the generic
  message on that condition, and the granular camera/DAQ breakdown (with its
  own more specific messages) is now exclusively available via Machine
  Configuration's relocated "Check Hardware". This is a real, if small,
  behavior change from what the original ui-management-pages spec described
  and is documented explicitly in this change's modified requirement rather
  than left as an implicit side effect.
  - Relatedly, the "connected/disconnected/error" wording from issue #339's
    body doesn't map cleanly onto the three states `PythonStatus.tsx`
    actually tracks today (`'Connected'`/status-includes-`'ready'`,
    `'Error'`, and everything else — there is no distinct "disconnected"
    signal separate from the initial `'Checking...'` state). Rather than
    inventing a new disconnect signal with no real trigger behind it, the
    modified spec relabels the three states that already exist: Connected,
    Checking, Error. This is the more honest option — it's directly
    implementable and testable against current code, versus a fourth
    "disconnected" option that risks reading as normative until an
    implementer discovers there's nothing to wire it to.

- **Decision: Home's simplified `PythonStatus` must not link to Machine
  Configuration.** The existing `ui-management-pages` spec already commits
  to this ("The Home page SHALL NOT show any link to Machine Configuration
  (admin-only, one-time-per-machine setup)"), and
  `tests/unit/components/PythonStatus.test.tsx` already asserts it. Removing
  the interactive buttons must preserve that decoupling — regular users see
  a status indicator plus the generic "Contact your administrator" message
  on failure; only admins who separately know to go to Machine Configuration
  get the diagnostic controls.

- **Decision: add a one-line doc note about the hidden Machine
  Configuration shortcut, not a code change.** Machine Configuration has no
  visible sidebar link — it's reachable only via the `Ctrl+Shift+,` /
  `Cmd+Shift+,` keyboard shortcut. Moving hardware troubleshooting there
  means a lab technician who hits a hardware error and doesn't already know
  that shortcut has no in-app path beyond "Contact your administrator." The
  user confirmed this trade-off is acceptable (matching #339's own ask and
  the existing #104-era precedent) but asked for a documentation reminder:
  `docs/CONFIGURATION.md` gets one added sentence noting that admins should
  relay the shortcut to technicians who may need to report hardware issues.
  This is documentation only — no code, no new UI, no new requirement.

## Risks / Trade-offs

- Relocating camera detection touches both `CameraSettingsForm.tsx` (removal)
  and `MachineConfiguration.tsx` (addition) in the same change — mitigated
  by TDD: write the new Machine Configuration tests first, confirm the
  removal doesn't break any existing `CameraSettingsForm`/`CameraSettings`
  test (all of which already exercise `showCameraSelection={false}` or
  don't assert on the selection UI, per exploration).
- The Restart Python confirm dialog is a UX speed bump, not a real
  correctness guard — an admin can still click through it mid-scan. This
  is accepted as this PR's deliberate scope boundary (see Decision above).
  A mid-scan restart today leaves that scan's `metadata.json`/frame files
  on disk with no corresponding database row (the in-flight `sendCommand`
  is rejected before `saveScanToDatabase()` runs) — this is a pre-existing
  gap the confirm dialog does not fix, but it is also not made any worse by
  relocating the button; today's version of this button has no confirm step
  at all, so this change is a strict safety improvement, not a regression.
- Issue #335 ("Verify accuracy of Basler camera IP-finding instructions")
  is about the same help-text block (`CameraSettingsForm.tsx`'s "Method 1:
  Basler Pylon Viewer / Method 2: Check Camera Label / Method 3: Router
  Admin Page" panel) that task 4.2 relocates into `MachineConfiguration.tsx`
  as part of moving the camera-detection UI. This proposal does not verify
  or change that help text's accuracy (it requires physical Basler hardware
  access, which is out of scope here — same category as the excluded
  Tier 5b hardware QA work) — it only moves the text verbatim to its new
  location. A comment will be left on #335 noting the relocation so it
  doesn't go stale once this change merges.
- **The restart-required notice (#334) is page-local, not app-wide.** It's
  component state inside `MachineConfiguration.tsx`; navigating away (the
  only way back to Home/CaptureScan, since the page has no in-page "close")
  unmounts the component and the notice is gone permanently, with no
  app-wide banner or cross-session reminder to replace it. Building real
  persistence (e.g. lifting the notice to `Layout.tsx`, which survives
  navigation, the way `WedgeBanner` does) would mean either wrapping every
  existing `MachineConfiguration`/`MachineConfigMode` test in a full
  `Layout` tree or inventing a new shared cross-component store — both
  meaningfully larger than this PR's "quick fixes" scope. Mitigated cheaply
  instead: the notice's own text now says "restart the application now...
  this notice won't reappear if you navigate away first," so the admin is
  told about the limitation rather than silently losing the reminder.
  Accepted as a known limitation, not fixed architecturally, in this pass.

## Migration Plan

No data migration. All changes are UI/default-value/message-text changes
within existing schemas and IPC contracts. Existing `~/.bloom/.env` files
are unaffected by the `bloom_api_url` default change (the default only
applies when no config exists yet); users with an already-configured stale
URL are unaffected until they manually update it (out of scope for this fix,
which only addresses the _default_ seeded for new installs).

## Open Questions

None outstanding — the three scope questions raised during clarification
(camera-detection fate, restart-guard strength, restart-notice scope) were
resolved with the user before this proposal was written (see Decisions
above).
