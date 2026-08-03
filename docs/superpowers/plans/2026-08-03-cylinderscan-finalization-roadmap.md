# CylinderScan Finalization Roadmap

**Status:** Drafted 2026-08-03 from two firsthand audits, then reconciled
2026-08-03 after an adversarial roadmap-level review (4 independent
`general-purpose` agents: factual accuracy, dependency/sequencing,
completeness, scope/consistency/safety), mirroring
`2026-07-30-graviscan-renderer-roadmap.md`'s process. See "Reconciliation
from adversarial review" below for what changed — the review added real
scope (e.g. #249, #120, pilot #3's metadata-readback gap) beyond the
user's original tier approval, so this reconciled version is pending a
final user sign-off before Tier 1 starts.

## Owner context

CylinderScan (Basler camera + NI-DAQ) is bloom-desktop's original scanner
mode, predating GraviScan. It traces back to a retired standalone app,
`eberrigan/bloom-desktop-pilot`, which is no longer maintained but still
defines the feature set and visual style CylinderScan is expected to match.
The ask driving this roadmap: close feature-parity gaps against the pilot,
fix known bugs, reach production-level data-integrity and metadata standards,
achieve visual parity with the pilot's style, and package + deploy to
Windows lab machines as soon as possible.

## Why a roadmap (not one proposal)

Investigation (one audit of `bloom-desktop-pilot`, one audit of current
`bloom-desktop`, 2026-08-03) found the gap spans several independent kinds of
work, each with its own risk profile:

- **One feature already done.** #78 (Cloud Upload for Scan Images) is
  fully implemented for CylinderScan today (`src/main/image-uploader.ts`,
  batch upload + progress + status column in `BrowseScans.tsx`) — separate
  infrastructure from GraviScan's upload path, not shared. The issue is stale;
  no new upload feature is needed, only hardening (see Tier 2).
- **One feature half-built with real stakes.** #79 (Delete Scan) works from
  `BrowseScans.tsx` (soft delete via `db.scans.delete`) but never updates
  `metadata.json` on disk (#105) and has no delete affordance on
  `ScanPreview.tsx` at all.
- **One feature genuinely missing.** #77 (Export Page for Batch Scan Export)
  has no route, no component, nothing — confirmed via `App.tsx` and a repo-wide
  search for "export" in `src/renderer` (only unrelated CSV-export code in
  GraviScan's `box-backup.ts` matched).
- **The pilot's own delete/upload design has three confirmed, still-live
  data-integrity bugs**, read directly from its code (not just issue titles):
  - `getImagesToUpload()` (`prismastore.ts:491-509`) never filters out images
    belonging to soft-deleted scans, so deleting a scan doesn't stop it from
    being re-queued for upload forever (pilot issue #57).
  - The upload dedup path marks an image `UPLOADED` when
    `created === null && error === null` (`imageuploader.ts:129-140`), with no
    check that the bytes actually exist in storage — silent data loss if the
    assumption is wrong (pilot issue #60, and #58 describes the resulting
    symptom).
  - No local scan/image UUID is ever sent to the cloud row (`imageuploader.ts`
    payload, lines 72-95), so a cloud record can never be traced back to the
    local DB row that produced it (pilot issue #59). There's also no audit
    mechanism of any kind (pilot issue #61).

  Current `bloom-desktop`'s `image-uploader.ts` has **not yet been checked**
  against these three specific failure modes — Tier 2 starts with that check,
  not with an assumption either way.
- **Several "bugs" are already fixed**, confirmed by reading the code, not the
  issue title: most of #95's camera-settings type mismatches (gain is
  properly `int`-typed and validated both in Python and the renderer form; the
  stale width/height fields are gone entirely). Re-litigating these would be
  wasted work.
- **Several bugs are confirmed still live**, exactly as titled: #93
  (`webSecurity: false` at `main.ts:156`), #96 (8 of 12 preload listeners lack
  cleanup, itemized in `preload.ts`), #97 (4 `any`-typed fields in
  `image-uploader.ts:96-103`), #47 (`sendCommand` in `python-process.ts:142-183`
  still has no request/response correlation), #40 (no `threading.Lock` in
  `python/hardware/scanner.py`, race window exactly as described), #198
  (`PythonStatus.tsx` renders Camera/DAQ status unconditionally, ignoring
  GraviScan mode).
- **Style drift is real but partial**, not a top-to-bottom redesign. The
  pilot's distinctive lime-accent / stone-100-background / amber-warning
  palette (`tailwind.config.js` extends only `sky`/`cyan` — same base config
  as current `bloom-desktop`, so the divergence is in usage, not config) is
  already present in `ConfigureScanner.tsx`, `ExperimentChooser.tsx`, and
  `PhenotyperChooser.tsx`, but `CaptureScan.tsx` and `CameraSettings.tsx` still
  use blue accents, and `CameraSettings.tsx` has no max-width container
  (`p-8`, full-bleed) unlike `CaptureScan.tsx`'s `max-w-7xl mx-auto` — which is
  exactly what the already-pending `align-page-layout-centering` OpenSpec
  change fixes.
- **Packaging has never been exercised against the real deployment target.**
  CI only runs `npm run package`, never `npm run make` (#251); the packaged-app
  DB test (`test-package-database` in `pr-checks.yml:552`) only runs on
  `macos-latest` — there is no Windows coverage at all, despite the target
  deployment machines being Windows (confirmed with the user, 2026-08-03).

None of this can be responsibly audited and closed out in one OpenSpec change.
Each tier below is its own proposal/PR, reviewed and merged independently.

## No numeric oracle — substitute validation target

This isn't a scientific pipeline validated against a published reference
dataset, so each tier's "validation target" (in place of an oracle) is:

1. **Spec conformance** — satisfies any already-accepted OpenSpec requirement
   naming the files/behavior this tier touches.
2. **Known-bug avoidance** — the proposal's design section explicitly states
   how it avoids reproducing the pilot's three confirmed data-integrity bugs
   (soft-deleted-scan upload re-queueing, unverified-storage UPLOADED
   marking, missing local↔cloud UUID linkage) wherever the tier touches
   delete/upload code — not silently copying the pattern.
3. **TDD + E2E coverage** — tests written first. Note current CylinderScan E2E
   coverage is thin (only `capture-scan-numeric-inputs.e2e.ts`,
   `scan-preview.e2e.ts`, `scan-directory-format.e2e.ts` touch CylinderScan
   flows; nothing covers delete, upload, or camera-settings-apply/stream) —
   remember the IPC coverage gate (CI's 90% gate statically scans
   `tests/e2e/renderer-database-ipc.e2e.ts` for `db:*` handler calls) when any
   tier adds new `database.*`/`db:*` handlers.
4. **No regressions** — full existing test suite stays green.

## Tiers

| # | Tier | Depends on | New backend? | Related issues | Status |
|---|------|-----------|---------------|-----------------|--------|
| 1 | Correctness & security hardening | — | Mostly no; #93 requires new protocol-handler registration + path-traversal validation logic, not a flag flip | #93, #96, #97, #47, #40, #198, #249 | Not started — unblocked, ready to propose next |
| 2 | Delete & upload data-integrity + acquisition metadata completion | — (parallel to 1; shares `image-uploader.ts` with Tier 1's #97, disjoint regions) | Yes — one small new `db:scans:checkDuplicate`-style handler (#120), possibly a metadata-readback extension (pilot #3) | #79, #105, #120, pilot #3, (#110 optional) | Not started — unblocked |
| 3 | Export page for batch scan export | — (the `Scan.deleted` field and its consistent `deleted: false` filtering convention already exist today; Tier 2 doesn't need to finish first) | Possibly — one new read-only IPC handler for scan enumeration by experiment/date, if none suitable exists | #77 | Not started — unblocked |
| 4 | Style/UX parity pass | — | No | `align-page-layout-centering` (pending), #104, #175 (scoped carefully — see below), #106, #107 | Not started — unblocked, can run anytime |
| 5a | Packaging CI/doc prep | — | No | #251, #57 (bloom-desktop), #180 | Not started — unblocked, can start immediately, no dependency on any other tier |
| 5b | Windows build, install, and full-workflow QA | 1, 2, 3 | No | (validates 1-3) | Not started — blocked on Tiers 1-3 |

## Reconciliation from adversarial review (2026-08-03)

Four independent `general-purpose` agents reviewed this document against
live repo state before Tier 1 was allowed to start. Summary of what changed
(full detail is inline in each tier below):

- **Factual accuracy review: no changes.** Every issue number, file:line
  citation, and hedged claim (e.g. #78 already implemented, #95 mostly
  fixed) was independently re-verified and confirmed accurate as drafted.
- **Dependency/sequencing review:** Tier 3's dependency on Tier 2 was
  removed (the `Scan.deleted` filtering convention it needs already exists
  today, unrelated to what Tier 2 changes). Tier 5 was split into 5a
  (CI/doc prep, no dependency, can start immediately) and 5b (the actual
  Windows build+install, gated on Tiers 1-3). A coordination note was added
  to Tier 1/Tier 2 for their shared edits to `image-uploader.ts`.
- **Completeness review:** added #249 (concurrent app instances) to Tier 1,
  added #120 (duplicate-scan blocking) and pilot #3 (acquisition-metadata
  readback gap) to Tier 2, added #110 as an optional bonus check in Tier 2,
  and added an explicit full-workflow manual QA pass to Tier 5b.
- **Scope/consistency/safety review:** corrected Tier 1's #93 and #40 from
  "mechanical, no open questions" to accurately scoped design work (see
  Tier 1 below for the specific mechanisms); flagged Tier 4's #175 as
  needing careful scoping to avoid unintentionally changing GraviScan's
  shared `WorkflowSteps.tsx` rendering; required Tier 2 to formally amend
  the already-accepted "Scan Delete IPC Handler" spec requirement, not just
  the code.

None of these were scope-fatal — all were reconcilable within the existing
5-tier shape, which is why the tier count stayed at 5 (5a/5b are a split of
one tier, not a new one).

### Tier 1 — Correctness & security hardening

Scope: seven fixes to existing files. Most are mechanical with no open
design questions, but two — flagged by adversarial review — need real design
work, not a one-line swap:

- **#93 — replace `webSecurity: false` (`main.ts:156`) with a custom protocol
  handler for local file access. NOT mechanical** — the existing code comment
  at `main.ts:152-156` confirms this flag exists specifically so `ScanPreview.tsx`
  can load local scan images under webpack-dev-server's http origin in dev.
  Removing it requires: registering a privileged custom scheme before
  `app.ready`, writing a handler with its own path-traversal validation (the
  flag currently bypasses exactly that check), and testing both the dev
  (http origin) and packaged (file origin) contexts on Windows paths
  specifically, since Tier 5 targets Windows. Scope the proposal accordingly —
  this is new main-process security logic.
- **#40 — thread safety in `python/hardware/scanner.py`. Verify the race is
  actually reachable before adding a lock.** `python/ipc_handler.py`'s command
  loop (`for line in sys.stdin`) is single-threaded and strictly sequential;
  the only background thread (`_streaming_thread`) touches a separate
  `_camera_instance`, never `Scanner.is_scanning`. Confirm during the
  proposal's design phase whether the race described in #40 is live under the
  current architecture or was inherited from a different threading model. If
  a `threading.Lock` is still warranted (e.g. for future-proofing or a
  reachable path not yet found), scope it narrowly around the
  check-then-set at lines 105/162/172/274 — **not** around all of
  `perform_scan()`, which can run for minutes; wrapping the whole call would
  make `cleanup()`'s `is_scanning` check at line 105 block for the full scan
  duration instead of immediately raising "Cannot cleanup during active scan,"
  a regression to a legitimate abort path.
- #96 — add cleanup functions to the 8 preload listeners currently missing
  them: `python.onStatus`, `python.onError`, `camera.onTrigger`,
  `camera.onImageCaptured`, `daq.onInitialized`, `daq.onPositionChanged`,
  `daq.onHome`, `daq.onError` (all in `src/main/preload.ts`), matching the
  pattern the other 4 listeners already use.
- #97 — replace the 4 `any`-typed fields in `image-uploader.ts:96-103` with
  proper types from `bloom-fs`/`bloom-js`. (Touches the same file as Tier 2's
  upload-integrity audit — disjoint regions, likely a clean merge, but
  whichever of Tier 1/Tier 2 merges first, rebase the other onto it before
  finalizing that tier's proposal, same discipline as the GraviScan roadmap's
  `preload.ts` coordination note.)
- #47 — add request/response correlation (e.g. a request ID) to
  `sendCommand` in `python-process.ts:142-183`, which currently uses a bare
  `this.once('data', ...)` with no way to match a response to its request.
- #198 — make `PythonStatus.tsx` mode-aware: accept a mode prop (or read
  `useAppMode`) and suppress Camera/DAQ-specific warnings when in GraviScan
  mode; make `python/ipc_handler.py:167`'s `check_hardware()` branch on mode
  too if it's currently CylinderScan-only. (Confirmed: `Home.tsx` renders
  `<PythonStatus />` unconditionally for both modes today — this fix removes
  GraviScan bleed, it doesn't introduce any.)
- **#249 (added by completeness review) — multiple concurrent app instances.**
  Cross-cutting (affects both scanner modes via shared `main.ts` singletons —
  `PythonProcess`/`CameraProcess`/`DAQProcess` — and shared SQLite access), but
  it's the same kind of mechanical, well-understood hardening as the rest of
  this tier: Electron's built-in `app.requestSingleInstanceLock()` is the
  standard pattern. Included here rather than left unaddressed, since a
  double-launch on a lab machine is a real data-corruption risk this roadmap's
  "production-level data integrity" goal can't responsibly ignore.

No feature-parity work happens in this tier — it exists to de-risk the
codebase before Tier 2 touches upload/delete.

### Tier 2 — Delete & upload data-integrity + acquisition metadata completion

Highest-stakes tier — this is what "production-level data integrity and
metadata preservation" points at directly. Four parts:

1. **Finish #79/#105.** `db:scans:delete` (`database-handlers.ts:1710-1728`)
   must also update the scan's `metadata.json` on disk (matching the pilot's
   `deleted: true` pattern, minus its bugs — see below), and `ScanPreview.tsx`
   needs a delete affordance (currently upload-only). Decide and document a
   file-retention policy (soft-delete-only, matching pilot, vs. hard deletion
   of image bytes) as part of the proposal — this is a real design decision,
   not just a port. **This proposal must also formally amend**
   `openspec/specs/ui-management-pages/spec.md`'s already-accepted "Scan
   Delete IPC Handler" requirement, which currently states deleted scans'
   files/Image records are not removed and says nothing about
   `metadata.json` — code-only changes here would leave the accepted spec
   silently stale.
2. **Audit `image-uploader.ts` against the pilot's three confirmed bugs,
   fix what's present:**
   - Does the current upload-queue query exclude images belonging to
     soft-deleted scans? If not, fix it (pilot bug #57 equivalent).
   - Does any code path mark an image `UPLOADED` without verifying the bytes
     exist in remote storage? If so, add a verification step before flipping
     status (pilot bug #60/#58 equivalent).
   - Is a local scan/image UUID included in the payload sent to the cloud
     row? If not, add it for cross-system traceability (pilot bug #59
     equivalent). Consider whether a lightweight audit/reconciliation check
     (pilot's missing #61) is in scope here or worth a follow-up issue.
   - Optional bonus check, cheap since this file is already open: #110 notes
     the pilot used 10 upload workers vs. this app's 4 — worth a quick look,
     not a blocker if out of scope.

   This audit happens first, in the proposal's design phase — the fix list
   above is provisional, not committed, until the current code is actually
   read. (Shares `image-uploader.ts` with Tier 1's #97 — disjoint regions,
   see Tier 1's coordination note.)
3. **#120 (added by completeness review) — block duplicate scans with the
   same plant/wave/age.** CylinderScan-specific (`CaptureScan.tsx`), needs a
   new `db:scans:checkDuplicate`-style handler — subject to the IPC coverage
   gate noted in the validation-target section above.
4. **Pilot #3 (added by completeness review) — acquisition-metadata
   completeness gap.** The pilot only ever captured the app's own
   user-configured camera settings (exposure, gain, brightness, contrast,
   gamma, seconds-per-rotation), never raw Basler API readback (actual
   applied exposure/gain, pixel format, ROI, firmware/serial). Confirm
   whether current `bloom-desktop` has the same gap, and if "metadata
   preservation" for this roadmap requires closing it now or is better
   scoped as its own follow-up tier/issue — decide explicitly in this
   proposal's design phase rather than leaving it silently unaddressed like
   the pilot did.

### Tier 3 — Export page for batch scan export

Net-new feature (#77). Mirrors the pilot's `Export.tsx` UX — experiment/date
grouped scan selection (checkbox tree), a target-directory picker, and
whole-scan-folder copy (preserving `metadata.json` and all images verbatim) —
rebuilt on current `bloom-desktop`'s IPC/data conventions rather than ported
file-for-file. Carries forward the one thing the pilot's export code got
right: filtering out soft-deleted scans (`Export.tsx:208,227`'s
`!scan.deleted` pattern). Dependency correction from adversarial review:
this does **not** require Tier 2 to finish first — `Scan.deleted`
(`prisma/schema.prisma:80`, `@default(false)`) already exists, `db:scans:list`
already filters `deleted: false` consistently today
(`database-handlers.ts:1464,1611,1670`), and Tier 2's actual scope (metadata.json
sync, delete affordance, upload-bug audit) never changes that filtering
convention. Export's new handler can copy the existing `where: { deleted:
false }` pattern verbatim regardless of Tier 2's status.

### Tier 4 — Style/UX parity pass

- Fold in the already-pending `align-page-layout-centering` OpenSpec change
  (`CameraSettings.tsx` max-width fix) as part of this tier rather than
  merging it standalone — it's one instance of the same style-parity gap this
  tier addresses.
- Sweep `CaptureScan.tsx` and `CameraSettings.tsx` (and any other stragglers)
  for blue/indigo accents that should be the pilot's lime/stone/amber palette,
  matching the convention already adopted in `ConfigureScanner.tsx`,
  `ExperimentChooser.tsx`, and `PhenotyperChooser.tsx`.
- #104 — Home page as a status dashboard with quickstart guide.
- **#175 — redesign the CylinderScan workflow guide. Scope carefully:**
  `WorkflowSteps.tsx` exports both `cylinderScanSteps` and `graviScanSteps`,
  rendered through the *same* `WorkflowSteps` component — GraviScan's Home
  screen uses this literal component with different step data. A redesign of
  the component itself (not just `cylinderScanSteps`'s data) will change
  GraviScan's rendered workflow guide too. This proposal must either scope
  the redesign to `cylinderScanSteps`'s data only, or if the component itself
  changes, explicitly verify GraviScan's rendering is unaffected (or
  intentionally and visibly updated) and test both modes — not treat this as
  CylinderScan-isolated by default.
- #106/#107 — add thumbnail-preview and camera-settings columns to
  `BrowseScans.tsx`'s table (currently: Plant ID, Accession, Capture Date,
  Experiment, Phenotyper, Wave, Age, Images, Upload Status, Actions — no
  preview/exposure/gain/device columns). Heads-up: Tier 2 may also touch this
  file's delete-affordance/state surfacing (`handleDelete`, line 101) — not a
  hard dependency, just worth checking the other tier's latest state before
  finalizing this one's diff if both are in flight at once.

No dependency on Tiers 1-3; can run in parallel with any of them.

### Tier 5a — Packaging CI/doc prep

Dependency correction from adversarial review: none of this depends on any
other tier. `pr-checks.yml`'s `test-package-database` job (lines 549-601) is
fully self-contained (checkout → package → test) and touches zero
CylinderScan feature code — it can start today, in parallel with Tier 1.

- #251 — exercise `npm run make` (not just `npm run package`) end-to-end in
  CI, including a Windows-installer-launch-equivalent smoke test (current CI
  never runs `make`, confirmed at `pr-checks.yml:598`).
- #57 (bloom-desktop's own, not the pilot repo's) — add Windows to the
  packaged-app DB test matrix; `test-package-database` currently only runs on
  `macos-latest` (`pr-checks.yml:552`), with zero Windows coverage despite
  Windows being the actual deployment target.
- #180 — audit the existing CylinderScan hardware validation docs (Basler +
  NI-DAQ) for currency before relying on them for the physical rollout.

### Tier 5b — Windows build, install, and full-workflow QA

Gated on Tiers 1-3 (shipping known security/race/data-integrity bugs to lab
machines would be worse than waiting) and benefits from Tier 5a's CI having
already exercised `make` before this tier relies on it manually.

- Build a signed, packaged Windows installer from the tip of Tiers 1-3
  merged, manually install it on the target machine(s), and run a hardware
  smoke test (camera trigger + DAQ + a real scan capture end-to-end).
- **Full-workflow manual QA pass (added by completeness review)** — the
  happy path Metadata → CaptureScan → capture → BrowseScans → ScanPreview →
  delete → export → upload, walked end-to-end by hand on the packaged
  Windows build. This is what actually closes the loop on "making sure
  everything is working as expected" — the per-tier TDD/E2E coverage above
  verifies each piece in isolation, not the full chain together.

## Process per tier

Each tier is its own OpenSpec change, run through the repo's existing
`/new-feature` workflow (brainstorm → `/openspec:proposal` → `openspec-review`
skill, 5 subagents → user approval → `/openspec:apply` with TDD →
`/pre-merge` → PR → `/cleanup-merged`).

## Tracking issues

Existing GitHub issues already cover this scope piecemeal (see the table
above; all confirmed open and re-characterized as of 2026-08-03 by reading
the actual code, not just issue titles). Whether to file a per-tier
umbrella/EPIC issue is left open for the user, matching the GraviScan
roadmap's precedent — filing issues is a visible, shared-state action.

## Closing the loop

After each tier's PR merges: tick this roadmap's table row, note the merged
PR/commit, and re-check the next tier's scope against whatever the just-merged
tier actually shipped before starting its proposal.
