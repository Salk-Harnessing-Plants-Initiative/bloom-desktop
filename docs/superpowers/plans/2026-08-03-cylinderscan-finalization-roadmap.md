# CylinderScan Finalization Roadmap

**Status:** Drafted 2026-08-03 from two firsthand audits (the retired
`bloom-desktop-pilot` repo, and current `bloom-desktop`'s CylinderScan code
cross-referenced against every open issue below). Not yet adversarially
reviewed — that review runs before Tier 1's proposal starts, mirroring
`2026-07-30-graviscan-renderer-roadmap.md`'s process.

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
| 1 | Correctness & security hardening | — | No — fixes to existing files only | #93, #96, #97, #47, #40, #198 | Not started — unblocked, ready to propose next |
| 2 | Delete & upload data-integrity completion | — (parallel to 1) | No — extends existing `db:scans:delete` + `image-uploader.ts` | #79, #105 | Not started — unblocked |
| 3 | Export page for batch scan export | 2 (needs correct delete-flag filtering) | Possibly — one new read-only IPC handler for scan enumeration by experiment/date, if none suitable exists | #77 | Not started — blocked on Tier 2 |
| 4 | Style/UX parity pass | — | No | `align-page-layout-centering` (pending), #104, #175, #106, #107 | Not started — unblocked, can run anytime |
| 5 | Windows packaging & deployment readiness | 1, 2, 3 | No | #251, #57 (bloom-desktop), #180 | Not started — CI/doc prep can start in parallel; final build+install gated on Tiers 1-3 |

### Tier 1 — Correctness & security hardening

Scope: six independent, mechanical fixes to existing files, each already
fully diagnosed (no open design questions):

- #93 — replace `webSecurity: false` (`main.ts:156`) with a custom protocol
  handler for local file access.
- #96 — add cleanup functions to the 8 preload listeners currently missing
  them: `python.onStatus`, `python.onError`, `camera.onTrigger`,
  `camera.onImageCaptured`, `daq.onInitialized`, `daq.onPositionChanged`,
  `daq.onHome`, `daq.onError` (all in `src/main/preload.ts`), matching the
  pattern the other 4 listeners already use.
- #97 — replace the 4 `any`-typed fields in `image-uploader.ts:96-103` with
  proper types from `bloom-fs`/`bloom-js`.
- #47 — add request/response correlation (e.g. a request ID) to
  `sendCommand` in `python-process.ts:142-183`, which currently uses a bare
  `this.once('data', ...)` with no way to match a response to its request.
- #40 — add a `threading.Lock` around the `is_scanning` check-then-set in
  `python/hardware/scanner.py` (currently racy at lines 105/162 vs. 172/274),
  plus a concurrency test in `python/tests/test_scanner.py`.
- #198 — make `PythonStatus.tsx` mode-aware: accept a mode prop (or read
  `useAppMode`) and suppress Camera/DAQ-specific warnings when in GraviScan
  mode; make `python/ipc_handler.py:167`'s `check_hardware()` branch on mode
  too if it's currently CylinderScan-only.

No feature-parity or data-integrity work happens in this tier — it exists to
de-risk the codebase before Tier 2 touches upload/delete.

### Tier 2 — Delete & upload data-integrity completion

Highest-stakes tier — this is what "production-level data integrity and
metadata preservation" points at directly. Two parts:

1. **Finish #79/#105.** `db:scans:delete` (`database-handlers.ts:1710-1728`)
   must also update the scan's `metadata.json` on disk (matching the pilot's
   `deleted: true` pattern, minus its bugs — see below), and `ScanPreview.tsx`
   needs a delete affordance (currently upload-only). Decide and document a
   file-retention policy (soft-delete-only, matching pilot, vs. hard deletion
   of image bytes) as part of the proposal — this is a real design decision,
   not just a port.
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

   This audit happens first, in the proposal's design phase — the fix list
   above is provisional, not committed, until the current code is actually
   read.

### Tier 3 — Export page for batch scan export

Net-new feature (#77). Mirrors the pilot's `Export.tsx` UX — experiment/date
grouped scan selection (checkbox tree), a target-directory picker, and
whole-scan-folder copy (preserving `metadata.json` and all images verbatim) —
rebuilt on current `bloom-desktop`'s IPC/data conventions rather than ported
file-for-file. Carries forward the one thing the pilot's export code got
right: filtering out soft-deleted scans (`Export.tsx:208,227`'s
`!scan.deleted` pattern) — which is why this tier depends on Tier 2 having
correct, consistent delete-flag semantics first.

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
- #175 — redesign CylinderScan's `WorkflowSteps.tsx` flat 7-step list into the
  richer workflow guide #104/#175 call for.
- #106/#107 — add thumbnail-preview and camera-settings columns to
  `BrowseScans.tsx`'s table (currently: Plant ID, Accession, Capture Date,
  Experiment, Phenotyper, Wave, Age, Images, Upload Status, Actions — no
  preview/exposure/gain/device columns).

No dependency on Tiers 1-3; can run in parallel with any of them.

### Tier 5 — Windows packaging & deployment readiness

Last by design — validates that everything above actually works packaged, on
the real target OS, before it ships to lab machines.

- #251 — exercise `npm run make` (not just `npm run package`) end-to-end in
  CI, including a Windows-installer-launch-equivalent smoke test (current CI
  never runs `make`, confirmed at `pr-checks.yml:598`).
- #57 (bloom-desktop's own, not the pilot repo's) — add Windows to the
  packaged-app DB test matrix; `test-package-database` currently only runs on
  `macos-latest` (`pr-checks.yml:552`), with zero Windows coverage despite
  Windows being the actual deployment target.
- #180 — audit the existing CylinderScan hardware validation docs (Basler +
  NI-DAQ) for currency before relying on them for the physical rollout.
- Build a signed, packaged Windows installer from the tip of Tiers 1-3 merged,
  manually install it on the target machine(s), and run a hardware smoke test
  (camera trigger + DAQ + a real scan capture end-to-end).

The first three bullets (CI/doc prep) can start in parallel with Tier 4 once
Tiers 1-2 are merged; the actual build-and-install is gated on Tiers 1-3.

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
