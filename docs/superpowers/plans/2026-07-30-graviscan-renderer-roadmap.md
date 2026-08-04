# GraviScan Renderer Roadmap

**Status:** Reconciled after adversarial roadmap review (2026-07-30, 4 independent
`Explore` agents: factual accuracy, dependency/sequencing, completeness,
scope/consistency/safety), approved, and now underway. Tiers 1, 2, and 3
merged 2026-07-31/08-04 (PRs #273, #274, #277). A prerequisite discovered
while scoping Tier 5, `add-wave-scoped-metadata-linking`, merged separately
as **PR #278** (2026-08-04) — not one of the five tiers below; see Tier 4
and Tier 5's own sections for what it changes for each. Tiers 4–5 not yet
started — see the table below and "Closing the loop." **Re-audited
2026-08-04** against current `main` (post #278, via 2 independent `Explore`
agents covering backend/preload wiring and nav/workflow-step routing) — one
further staleness gap found and corrected below (Tier 5's handler
attribution); everything else checked out.

**Owner context:** Follows the GraviScan backend-parity port (PRs #267–#272,
merged 2026-07-29/30, archived `openspec/changes/archive/2026-07-30-*`). That
port brought GraviScan's scan-control backend (detect/config/start/cancel/
status/upload/download/verify-plates — the `gravi:*` IPC namespace) to parity
with the production branch, but explicitly scoped renderer work out. This
roadmap resumes that renderer work (originally GitHub issue #133, "GraviScan
7/7: Renderer UI").

## Why a roadmap (not one proposal)

Investigation (two `Explore` agents, 2026-07-30) found the renderer gap is
larger than "write UI against an already-ported API":

- `main` has zero GraviScan renderer code. Selecting GraviScan mode today
  routes into CylinderScan screens that never call GraviScan IPC.
- `main`'s main-process backend has 4 handlers already implemented but never
  wired into the preload bridge (`get-scanner-status`, `ensure-dir`,
  `list-scan-files`, `verify-plates` + its 3 push events) — confirmed via grep:
  zero occurrences of these channel names in `src/main/preload.ts`, all four
  registered as `ipcMain.handle` in `src/main/graviscan/register-handlers.ts`
  (lines 222, 342, 381, 428). Pure wiring gaps.
- The production branch (`fix/v600-wedge-followups-metadata_propogation_followup`,
  confirmed running on rig `graviscan-ms-7c56`) has a full renderer, but calls a
  differently-named, larger preload surface (`window.electron.graviscan.*` vs.
  main's `window.electron.gravi.*`) with a granular per-job event model
  (`onScanStarted`/`onScanComplete` with `jobId`/`scannerId`/`plateIndex`) that
  main's coarser generic bus (`onScanEvent`, `onGridStart`) doesn't have.
  (Correction from the 2026-07-30 review: GitHub issues #208/#133/#207 cite a
  pilot branch named `feature/graviscan` — not `feature/graviscan-prod`, which
  is a separate, diverged branch found during exploration; the two have 79 vs.
  9 mutually-unique commits and are not the same lineage. This roadmap's tiers
  are grounded directly in the **production branch**, audited firsthand via
  `git diff`/`git show` — not in either pilot branch — so this correction
  doesn't change any tier's scope, only the "why a pilot exists" narrative.)
- The production branch's Browse/ExperimentDetail/Metadata-upload screens run
  on a `database.graviscans.*`/`graviscanSessions`/`graviPlateAccessions`/
  `graviscanPlateAssignments`/`listGraviMetadata` IPC layer that **does not
  exist on `main` at all**, even though the underlying Prisma models
  (`prisma/schema.prisma:107-276`) already do. That's a full backend increment,
  not UI work.
- The production branch's renderer itself has real bugs, consistent with the
  pattern found during the backend port (see
  `docs/superpowers/plans/2026-07-24-graviscan-backend-hardening.md` and
  `2026-07-29-graviscan-production-parity-gaps.md`): a hardcoded `/tmp`
  fallback that breaks on the Windows-capable build (confirmed exact line:
  `useScanSession.ts:1259`, `useTestScan.ts:78`), 1,508 lines of dead
  scanner-config code presented as live (`ScannerConfigSection.tsx` 816 lines +
  `useScannerConfig.ts` 692 lines, confirmed unused via `git grep`), a
  `verifyPlates` status-value mismatch between the declared type and actual
  renderer usage, fire-and-forget `cancelScan()` with no error handling, a
  divide-by-zero risk in cycle-count math, and a state+ref-mirroring pattern in
  `useScanSession.ts` shaped like the exact pattern that caused the coordinator
  livelock found during the backend port.
- The production branch also uses a **build-time `APP_MODE` constant**
  (separate builds per rig) and deletes main's runtime `scanner_mode`
  IPC-based mode selection entirely — a real architecture fork. **Decision
  (2026-07-30): keep main's existing runtime `scanner_mode` model.** It already
  works and is tested for CylinderScan today; adopting the production branch's
  build-time model would be a much larger, riskier change touching CylinderScan
  too, for no benefit this roadmap needs. Every tier below builds its routes as
  `{mode === 'graviscan' && (...)}` blocks in `App.tsx`, matching the existing
  CylinderScan pattern — not as a separate dispatcher shell like the production
  branch's `Scanning.tsx`.

None of this can be responsibly audited and rebuilt in one OpenSpec change.
Each tier below is its own proposal/PR, reviewed and merged independently —
the same discipline that caught the Critical bugs during the backend port.

## No numeric oracle — substitute validation target

This isn't a scientific pipeline validated against a published reference
dataset, so each tier's "validation target" (in place of an oracle) is:

1. **Spec conformance** — satisfies every already-accepted OpenSpec requirement
   that names the files/behavior this tier touches (checked at proposal time
   against `openspec/specs/ui-management-pages/spec.md` and
   `openspec/specs/scanning/spec.md`).
2. **Known-bug avoidance** — the proposal's design section explicitly states
   how it avoids each relevant bug pattern listed above (not silently
   reproducing them via copy-paste).
3. **TDD + E2E coverage** — tests written first, covering the tier's new
   behavior including edge cases identified above (e.g. zero-interval guard,
   cancel-scan error surfacing, crash/reload session restoration).
4. **No regressions** — full existing test suite (`npm run test:unit`,
   `tests/unit/graviscan/*`, relevant E2E) stays green.

## Cross-cutting: mode-aware routing & nav (no dedicated tier — owned incrementally)

Two already-accepted `openspec/specs/scanning/spec.md` requirements — **"Mode-
Aware Home Page"** and **"Mode-Aware Navigation"** — anticipate GraviScan's
workflow steps (Scientists → Phenotypers → Metadata → Experiments → Capture
Scan → Browse Scans) and nav links. **Re-verified 2026-08-04 against current
`main`** (the placeholder framing below was previously a generalization, not
independently checked per-step — corrected here to what each step's route
actually resolves to):

- **"Browse Scans"** (`WorkflowSteps.tsx`) points at `/browse-scans`, a real
  working page (`BrowseScans.tsx`) backed by CylinderScan's shared
  `database.scans.*` data layer.
- **"Metadata"** points at `/experiments` — the same route as the
  "Experiments" step, i.e. an alias, not a distinct placeholder page.
- **"Capture Scan"** points at `/capture-scan`, a route `App.tsx` only
  registers under `mode === 'cylinderscan'`. In GraviScan mode there is no
  matching route at all — it falls through to the catch-all
  `<Route path="*" element={<Navigate to="/" />} />` and silently redirects
  Home. This is a dead link today, not a working CylinderScan placeholder.

Rather than one tier speculatively rewiring `Home.tsx`/`WorkflowSteps.tsx`/
`Layout.tsx` for screens that don't exist yet, **each tier updates the one
workflow-step/nav-link entry its own new route makes real**, as part of
that tier's own proposal:

- Tier 1 adds a `/configure-scanner` route + nav link (not one of the six
  named workflow steps, so no `WorkflowSteps.tsx` change — just `Layout.tsx`).
  **Confirmed shipped** (`Layout.tsx`'s `graviscanLinks` array).
- Tier 4 fixes the "Capture Scan" step and nav link to point at the new
  GraviScan scan screen instead of today's dead link.
- Tier 5 fixes "Metadata" and "Browse Scans" steps/nav to point at the new
  screens instead of today's alias route / CylinderScan-shared route.

This also resolves what would otherwise look like a gap: the production
branch's `Scanning.tsx` dispatcher, its deletion of `useAppMode.ts`/
`WorkflowSteps.tsx`, and its parallel CylinderScan-side restructuring
(`Accessions.tsx` deletion, new `CylinderScan.tsx`/`BrowseCylinderScans.tsx`)
are all artifacts of the build-time `APP_MODE` architecture this roadmap
explicitly does **not** adopt (see above). Main's existing CylinderScan screens
already work today and need no changes; nothing here replicates that
restructuring.

`ToastContext.tsx` (production branch) is likewise **not** being ported:
`openspec/specs/ui-management-pages/spec.md`'s "Per-Scanner Remove Button"
requirement already documents that this codebase deliberately moved _away_
from a toast-based design back to inline banners ("Per Cluster D... the
implementation uses the existing inline `saveError` banner pattern...
re-introducing toasts is a future-redo concern"). Every tier below follows
that accepted convention. Whether a shared `UploadStatusContext`-style global
upload-progress indicator is worth adding is deferred to Tier 5's own proposal,
where the actual need (persistent progress visible while browsing away from
the upload screen) can be scoped concretely.

## Tiers

| #   | Tier                                              | Depends on                                                           | New backend?                                                                               | Related issues                        | Status                                      |
| --- | ------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------- |
| 1   | Configure Scanner UI                              | —                                                                    | Preload wiring (`get-scanner-status`) + one small new IPC read for #245's env-state banner | #208, #133, #230, #245                | ✅ Merged — PR #273 (`d49d389`, 2026-08-03) |
| 2   | GraviScan DB data-layer port + event-model change | — (parallel to 1, see coordination note)                             | Yes — full increment                                                                       | #133 (backend half), #234, #231, #232 | ✅ Merged — PR #274 (`9805bba`, 2026-07-31) |
| 3   | Wedge-response UI (fast-tracked)                  | 2                                                                    | No — consumes Tier 2's granular events                                                     | #244, #240                            | ✅ Merged — PR #277 (`4782a0b`, 2026-08-04) |
| 4   | Core scan-operation screen                        | 1, 2, 3; re-check vs. `add-wave-scoped-metadata-linking` (see prose) | Preload wiring only (`verify-plates` + its events)                                         | #133, #162                            | Not started — unblocked                     |
| 5   | Browse / Experiment Detail / Metadata UI          | 2; wave-scoped metadata-link UI also needs `add-wave-scoped-metadata-linking` (merged PR #278, see prose) | Preload wiring only (`ensure-dir`, `list-scan-files`)                                      | #133, #207, #164                      | Not started — unblocked (Tier 2 + PR #278 both merged) |

**Coordination note (Tier 1 / Tier 2 parallel work):** both tiers edit
`src/main/preload.ts`'s `graviAPI` object — Tier 1 adds one method near the
existing scanner-operation wrappers (~line 312), Tier 2 restructures the
event-listener section (~lines 330–397) and adds new `database.*` keys
elsewhere in the file. The hunks are disjoint and a clean merge is likely, but
whichever PR merges first should be rebased onto by the other before that
tier's proposal is finalized, rather than assuming true independence.

**Issue reassignment from the original draft (per 2026-07-30 review):** #234
(detect-scanners doesn't spawn workers for new rows) and #231 (per-scanner
`grid_mode` update omits the field) are pure backend defects with no renderer
surface — moved from Tier 1 to Tier 2. #232 (V600 silently rounds DPI) has a
backend-correctness half (Tier 2, validate/clamp or record the achieved
resolution) and a UI-honesty half (Tier 1 may optionally surface the
DB-recorded value without over-claiming precision) — listed under both, not
Tier 1 alone. #197 (mock-hardware toggle) and #198 (PythonStatus
mode-awareness) were dropped from Tier 1 entirely: both had larger blast
radius than the "fast, low-risk first slice" framing intended (#197 touches
`CaptureScan.tsx`, a CylinderScan-only file, plus `config-store.ts`; #198's
stated justification — "renders on every page" — is factually wrong,
`PythonStatus` only renders on `Home.tsx`). Both become their own small
follow-up tier/tickets, out of this roadmap's scope for now.

### Tier 1 — Configure Scanner UI

Scope: new `src/renderer/ConfigureScanner.tsx` (route `/configure-scanner`,
GraviScan-mode-gated in `App.tsx`, nav link in `Layout.tsx`), scanner
detect/save/enable/disable/reset-usb flow, live per-scanner status (needs the
`get-scanner-status` preload exposure this tier adds). Implements the two
already-accepted-but-unimplemented spec requirements that name this page: **DPI
Dropdown Restricted to Validated Set** (trim `GRAVISCAN_RESOLUTIONS` in
`src/types/graviscan.ts:163-165` from `[200,400,600,800,1200,1600,3200,6400]`
to `[200,400,600,800,1200,1600]`) and **Per-Scanner Remove Button** (per spec,
but correcting the spec's illustrative `window.electron.graviscan.disableScanner`
reference — `openspec/specs/ui-management-pages/spec.md:1726,1749` — to match
main's actual `window.electron.gravi.disableScanner` namespace; flag as a spec
amendment in the proposal). Issue #230 (stale scanner rows, no disable UI) is
resolved by this same Remove-button work. Issue #245 (Slack webhook/
`LIBUSB_ENDPOINT_RECOVERY` env-state banner) is folded in as a small,
GraviScan-specific addition — confirmed to need one small new main-process IPC
read, not just preload wiring; the table above reflects that honestly.

No new `database.*` handlers needed — `saveScannersToDB`/`saveConfig`/
`getScannerStatus` already call Prisma directly inside `graviscan:*`-namespaced
handlers, a separate surface from the app's `database.*`/`db:*` IPC convention
that Tier 2 extends.

### Tier 2 — GraviScan DB data-layer port + event-model change

Backend-only, no renderer code. Two things bundled because both require
re-auditing the same already-hardened surface (coordinator/wiring) with the
same rigor as PRs #267–#272:

- Port `database.graviscans.*` (`create`, `browseByExperiment`,
  `experimentDetail`, `getMaxWaveNumber`, `checkBarcodeUniqueInWave`,
  `updateGridTimestamps`), `graviscanSessions.*` (`create`, `complete`),
  `graviscanPlateAssignments.*` (`upsertMany`, `list`), `graviPlateAccessions.*`
  (`createWithSections`, `list`, `listFiles`, `delete`), and
  `experiments.{listGraviMetadata,linkGraviMetadata,unlinkGraviMetadata}` into
  `src/main/database-handlers.ts` (the existing convention, not a new
  namespace) — auditing each for the bug classes the backend port already
  found elsewhere (cross-experiment scoping, case-sensitivity, path
  containment, race conditions), not assuming the reference implementation's
  version is correct.
- Fix #234 (detect-scanners doesn't spawn workers for newly-discovered rows)
  and #231 (per-scanner `grid_mode` UPDATE omits the field) as part of this
  same backend audit pass. Address #232's correctness half (V600 silently
  rounds requested DPI; validate/clamp against the driver's real supported set
  or record the achieved value, not just what was requested).
- Change the coordinator/wiring event model from main's generic bus
  (`onScanEvent`, `onGridStart`) to granular per-job events (`onScanStarted`,
  `onScanComplete`, `onScanError` carrying `jobId`/`scannerId`/`plateIndex`) —
  per 2026-07-30 decision to adopt the production branch's richer model. This
  explicitly includes updating `wiring.ts`'s `setupWedgeDetection()` (currently
  pattern-matches on `event.type` from the generic `scan-event` channel) to the
  new event shape — not just the `ScanCoordinator`'s `emit()` call sites —
  since Tier 3 depends on wedge detection continuing to work correctly through
  this change. This touches code that already had a livelock bug found and
  fixed during the backend port, so needs commensurate test rigor, not a quick
  bolt-on.

### Tier 3 — Wedge-response UI (fast-tracked)

Depends only on Tier 2 (needs the coordinator + granular per-job events; does
**not** need Tier 1's Configure Scanner screen or the full scan-operation
screen this was originally bundled into). Pulled out as its own small tier
per 2026-07-30 review: issue #244 documents this as "permanent data loss, no
recovery" for time-lapse experiments today, and bundling it into the larger,
higher-rebuild-risk core scan screen would couple a safety fix's timeline to
the tier most likely to slip. Scope: an in-UI wedge banner (#240) with
resume/skip/retry affordances (#244), rendered against a minimal placeholder
scan-state view — merged into the full Tier 4 screen once that lands, not
held until then.

### Tier 4 — Core scan-operation screen

Depends on Tiers 1 (scanners must be configured first — the only path by which
the DB/coordinator state that `startScan` requires gets populated, since `main`
has no other GraviScan renderer code today), 2 (DB layer to persist completed
scans/sessions, granular event model for live progress), and 3 (integrates the
wedge-response UI built there rather than rebuilding it). New `GraviScan.tsx`-
equivalent screen and supporting hooks (`useScannerStatus`, `usePlateAssignments`,
`useWaveNumber`, `useContinuousMode`, `useScanSession`, `useTestScan` —
rebuilt, not ported), designed to avoid the production branch's known issues:
no hardcoded `/tmp` fallback, no fire-and-forget `cancelScan()`, a guarded
zero/negative interval check before the cycle-count division, and a session
state design that avoids the ref-mirroring shape that caused the earlier
livelock. Reproduces the production branch's genuinely valuable UX
deliberately and with tests, not by copying the file: predictive cadence
warning (already an accepted spec requirement), graded-severity QR-verification
result banner, and session restoration across app restart.

**Re-check against `add-wave-scoped-metadata-linking` (merged PR #278, not one
of the five original tiers — a prerequisite discovered while scoping Tier 5):
two open questions from that change's `design.md` point at this tier
specifically, and should be resolved as part of this tier's own proposal
scoping, not carried further as unowned questions:**

- **Issue #162** (QR verification not wave-scoped) was deferred there
  specifically because `verify-plates.ts`'s IPC handler had no `waveNumber`
  parameter anywhere in its call chain and no renderer caller existed yet to
  supply one. This tier _is_ that caller — decide whether to thread
  `waveNumber` through as part of the "graded-severity QR-verification result
  banner" work above, or explicitly defer again with a reason.
- Prior-art evidence (unmerged draft PR #212, "Capture Scan auto-fill 4/4",
  same author as #209-211) suggests `usePlateAssignments` may need
  `listGraviMetadata` (now available) to auto-fill plate/accession metadata
  per wave, rather than requiring manual entry each capture. Confirm whether
  this tier's `usePlateAssignments` should consume it, or whether that's
  Tier 5-only scope.

### Tier 5 — Browse / Experiment Detail / Metadata UI

Depends on Tier 2 (all three screens are built on the DB data-layer that tier
ports); independently testable/demoable without Tier 4 by seeding
`GraviScan`/`GraviScanSession`/`GraviPlateAccession` rows directly via Prisma,
matching this repo's existing test convention (e.g.
`tests/integration/database.test.ts`, `tests/unit/graviscan/image-handlers.test.ts`)
rather than requiring the capture screen to produce real data first. New
`BrowseGraviScans.tsx`, `ExperimentDetail.tsx`, and `Metadata.tsx`/
`GraviMetadataUpload.tsx`/`GraviMetadataList.tsx`, plus the wave-scoped
metadata-link UI in `Experiments.tsx`/`ExperimentForm.tsx`.

**Correction (2026-08-04, found while re-auditing this roadmap before
starting Tier 5):** an earlier version of this section attributed the
wave-scoped metadata-link handlers (`listGraviMetadata`/`linkGraviMetadata`/
`unlinkGraviMetadata`) to "Tier 2." That was wrong even at write-time — Tier
2 explicitly descoped them (they need a `GraviExperimentWaveMetadata` Prisma
model Tier 2 didn't add; see Tier 2's own archived `design.md`, Decision 1).
A separate change, `add-wave-scoped-metadata-linking`, built them instead —
merged as **PR #278** (2026-08-04), backend-only, no renderer code, and
already archived on `main` (`openspec/changes/archive/2026-08-04-add-wave-scoped-metadata-linking/`).
Read its `design.md` there for the exact validation rules
`linkGraviMetadata` enforces
(experiment must be `experiment_type === 'graviscan'`, accession must have
≥1 `GraviPlateAccession` row, `waveNumber` a non-negative integer, no
re-linking an already-linked wave without unlinking first) rather than
re-deriving them. Issue #164 ("Support per-wave metadata uploads for QR
verification") is the underlying motivation for both that change and this
tier's `GraviMetadataUpload.tsx` — this tier is the UI consumer, not a
second implementation of the linking logic.

Extracts the production branch's duplicated imperative drag-resize DOM code
into one shared hook/utility instead of copying it twice, fixes the
`verifyPlates` status value mismatch against the real backend contract before
displaying verification results, and does not port the dead
`ScannerConfigSection`/`useScannerConfig` code.

## Process per tier

Each tier is its own OpenSpec change, run through the repo's existing
`/new-feature` workflow (brainstorm → `/openspec:proposal` → `openspec-review`
skill, 5 subagents → user approval → `/openspec:apply` with TDD →
`/pre-merge` → PR → `/cleanup-merged`). Prefer running each tier as its own
session once context on the prior tier's merged state is needed, rather than
carrying all five tiers in one long-running session.

## Tracking issues

Existing GitHub issues already cover most of this scope piecemeal (see the
table above; all confirmed open and accurately characterized as of 2026-07-30).
Whether to file a per-tier umbrella/EPIC issue linking them is an open question
for the user — not done as part of writing this roadmap, since filing issues
is a visible, shared-state action.

## Closing the loop

After each tier's PR merges: tick this roadmap's table row, note the merged
PR/commit, and re-check the next tier's scope against whatever the just-merged
tier actually shipped (not what this roadmap assumed) before starting its
proposal.
