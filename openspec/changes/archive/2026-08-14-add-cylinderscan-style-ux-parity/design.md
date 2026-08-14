## Context

The CylinderScan finalization roadmap's Tier 4 entry claimed the lime/stone/amber palette was "already present in `ConfigureScanner.tsx`, `ExperimentChooser.tsx`, and `PhenotyperChooser.tsx`." This was checked directly before writing this proposal and is **not accurate**: a full-tree grep for `lime-`/`stone-` across `main`, every in-flight worktree, and every remote branch returned zero matches anywhere. The only real, attested source for this palette is the retired `bloom-desktop-pilot` repo (`c:\repos\bloom-desktop-pilot`), read directly.

Separately, the roadmap doc's own summary of issues #104/#175/#106/#107 (used to draft this proposal's first revision) turned out to understate their actual scope — see "Revision history" below.

## Revision history

**Revision 1 (initial draft)** scoped #175 as a content-only refresh of `cylinderScanSteps` (leaving `graviScanSteps` and the component's structure untouched) and #104 as hardware-status-plus-quickstart only (no recent-activity data). A 5-lens pre-implementation review (`openspec-review`, round 1) fetched the actual GitHub issue text directly and found both were materially under-scoped relative to what the issues ask for, plus several color-sweep stragglers and spec-quality gaps. Specifically:

- **#175's actual text** asks for a structural two-section split (Daily Workflow vs. Setup, no step numbers) applied to **both** CylinderScan and GraviScan ("The same setup-vs-daily split applies to GraviScan workflow steps too") — not a per-mode content edit within the existing flat numbered layout.
- **#104's actual text** lists "Recent activity summary" (last few scans, upload-status counts, failed-upload link) as a first-class checklist item, not an optional nice-to-have.
- **#107's actual text** asks for a Scanner Name/Device column alongside Exposure/Gain, which the first revision dropped without stated rationale.
- Code-feasibility review found unaddressed blue in `Layout.tsx`'s sidebar nav-link (adjacent to the shell-background change already in scope), `Accessions.tsx`'s subcomponents (CylinderScan-only, same category as the other CylinderScan-only files already in scope), and `ExperimentForm.tsx`/`PhenotyperForm.tsx`/`ScientistForm.tsx` (shared, both-mode, identical pattern to `ExperimentChooser`/`PhenotyperChooser` already in scope).
- Spec-quality review found the MODIFIED "BrowseScans List View" requirement silently rewrote pre-existing spec drift (route, column list) without documenting it as intentional, and flagged an untestable `bg-lime-700 hover:bg-lime-50` "or equivalent" scenario.
- TDD review found an inaccurate test-mocking pointer, an unfounded "must hunt down a breaking test" risk premise (none exists), and zero existing test coverage for `BrowseScans.tsx` that this revision's new test file should at least partially backfill.

All of the above were brought back to the user as three explicit scope decisions (full #175 restructure applied to both modes; add #104's recent-activity widget; add #107's Scanner Name column — all three accepted) plus a set of review findings fixed directly without needing further sign-off (the color-sweep stragglers, spec-drift documentation, and TDD-plan corrections). This is Revision 2, reflecting all of the above.

**Revision 3** followed a round-2 review of Revision 2 (verifying round-1 fixes actually landed, plus a fresh look at the now-larger scope). Round 2 found: a fully independently-verified **BLOCKING sequencing conflict** — two open, actively-being-finished PRs (#289 "GraviScan Core Scan-Operation screen," #290 "GraviScan Browse/Experiment Detail/Metadata UI") edit `Layout.tsx`, `WorkflowSteps.tsx`, and `ExperimentForm.tsx` — the same files this change restructures — and #290 specifically rewrites `graviScanSteps`' routes (`Metadata` `/experiments`→`/metadata`, `Browse Scans` `/browse-scans`→`/browse-graviscans`) and creates its own `tests/unit/components/WorkflowSteps.test.tsx`, the identical new file this change also creates. One more genuinely missed color-sweep straggler (`MachineConfiguration.tsx`, reachable from both modes, unlike the correctly-excluded GraviScan-only `ConfigureScanner.tsx`). A real design flaw in the planned `upload-status.ts` extraction (a per-scan status-label function can't produce the Home widget's cross-scan aggregate by simple copy-paste). A minor citation gap and an incomplete test-mock enumeration. And an issue-alignment gap on #104: the "Today's Activity" widget's today-only scoping means a failed upload from a prior day surfaces no alert at all, undercutting the issue's "needing attention" framing on any day with no new captures.

All of these were brought back to the user. Decisions: **wait for #289/#290 to merge before starting implementation** (rather than build against a moving target, or narrow #175 back to CylinderScan-only); and **add a separate, date-unscoped failed-upload indicator** (rather than accept the today-only gap). The remaining findings (MachineConfiguration.tsx, the upload-status util redesign, the citation gap, the mock-list gap) are fixed directly below. This is Revision 3.

**Revision 4** (2026-08-12): after a week of waiting, #289 and #290 are still open _and still being actively edited_ (both had commits pushed the same day this revision was written) — not stalled-but-stable, genuinely a moving target. The user chose to stop waiting and narrow scope instead of building against files two other in-flight PRs are actively rewriting. The narrowing: **`WorkflowSteps.tsx`'s structural restructure is CylinderScan-only now** (a new, separate component, not a change to the shared file's `graviScanSteps`/`WorkflowSteps` rendering at all), and **`Layout.tsx`'s shell-background/sidebar-nav-link recolor is deferred entirely** — neither is touched by this change anymore. Everything else (the rest of the color sweep, `CameraSettings.tsx` centering, the Home dashboard widgets, BrowseScans' new columns) is unaffected by this narrowing and proceeds as already reviewed. See "Deferred Scope" below for exactly what moved out and why, and the new "Decision: `WorkflowSteps.tsx` stays untouched" below for how the structural split was re-architected to make this possible without half-measures.

## Deferred Scope (Revision 4)

Two pieces of the originally-approved scope are **deferred to a follow-up**, not implemented by this change, specifically to avoid building against `Layout.tsx`/`WorkflowSteps.tsx` while #289/#290 are actively rewriting them:

1. **`Layout.tsx`'s shell-background (`bg-gray-50`→`bg-stone-100`) and sidebar-nav-link recolor.** Not touched by this change at all. Both PRs edit this file substantially (#290: mode-based route gating, `alwaysLinks` changes; #289: a new nav link, wraps `Outlet` in `WedgeProvider`) — even a color-only two-line change here would sit inside heavily-in-flux markup. `ExperimentForm.tsx`'s two-line focus-ring color swap (also touched by #290, which adds a wave-attach panel there) is judged low-risk enough to keep in scope — it's a mechanical class-string edit on existing lines, not a structural change, so a later rebase conflict (if any) resolves trivially; `Layout.tsx`'s changes are categorically bigger and were the ones actually flagged as colliding.
2. **`graviScanSteps`'s Daily-Workflow/Setup structural restructure** (the #175 "applies to both modes" half). GraviScan's workflow guide keeps its exact current flat numbered list, unchanged in every respect — see "Decision: `WorkflowSteps.tsx` stays untouched" below for how this was achieved without half-measures.

**Follow-up:** filed as a new GitHub issue (see PR description) to apply both pieces to GraviScan once #289/#290 merge and settle — not silently dropped.

## Goals / Non-Goals

- **Goals:** replace blue/indigo accents with a lime/stone/amber convention adapted from the pilot's real usage (all CylinderScan-only/shared-form/shared-page stragglers found in review, excluding `Layout.tsx` — see Deferred Scope); center `CameraSettings.tsx`; restructure CylinderScan's workflow guide into Daily Workflow / Setup sections (via a new, dedicated component); add a Home "Today's Activity" summary; add thumbnail and camera-settings (incl. Scanner Name) columns to `BrowseScans.tsx`.
- **Non-Goals (Revision 4):** re-skinning `CaptureScan.tsx`'s green "Start Scan" CTA; `ConfigureScanner.tsx` (GraviScan-only); a general gray→stone sweep of `BrowseScans.tsx`'s existing chrome beyond its literal blue instances; a new IPC handler beyond `getFailedUploadCount`; a Prisma schema change; #175's explicitly-"optional" session-checklist enhancement; a column-configuration UI for #107; **`Layout.tsx`'s shell/sidebar recolor and `graviScanSteps`'s structural restructure — both deferred (see "Deferred Scope"), not abandoned.**

## Decisions

### Decision: Pilot palette mapping — verified source, adapted (not literally ported)

Read in full from the pilot repo. Actual pilot conventions and the adaptation applied (unchanged from Revision 1):

| Element                                                                                                                        | Pilot's actual class                      | Adapted for bloom-desktop                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Primary button                                                                                                                 | `bg-lime-700 text-white`, opacity-hover   | `bg-lime-700 text-white hover:bg-lime-800` (shade-hover, matching existing convention)            |
| Link                                                                                                                           | `text-lime-700`, underline-only hover     | `text-lime-700 hover:text-lime-800` (shade-hover)                                                 |
| Page/shell background                                                                                                          | `bg-stone-100`                            | `bg-stone-100`                                                                                    |
| **Active/hover nav-link state** (documented for the deferred follow-up, not implemented by this revision — see Deferred Scope) | `bg-stone-200` (pilot's `Layout.tsx:210`) | `bg-stone-200` text/border equivalents in place of `bg-blue-50`/`text-blue-600`/`border-blue-600` |
| Warning border                                                                                                                 | `border-amber-300`                        | unchanged — already correct today                                                                 |
| Focus ring                                                                                                                     | none in pilot                             | `focus:ring-lime-500` — **novel, not attested in the pilot**, a deliberate extrapolation          |

**Revision 2 addition, since deferred in Revision 4:** `Layout.tsx:285-289`'s sidebar nav-link (`hover:bg-blue-50 hover:text-blue-600`, active state `bg-blue-50 text-blue-600 border-r-4 border-blue-600`) was missed in Revision 1 despite `design.md` claiming to have read `Layout.tsx` in full — code-feasibility review caught this, and caught that the pilot's own `Layout.tsx:210` already solved exactly this with `bg-stone-200` on its active nav item. Adopting `bg-stone-200`/lime text-and-border equivalents here would keep the sidebar coherent with a `bg-stone-100` shell — **but neither is implemented by this revision**, since `Layout.tsx` is actively being rewritten by #289/#290 (see "Deferred Scope"). The mapping is preserved here for whoever picks up the follow-up.

**Revision 2 addition — CylinderScan-only stragglers:** `Accessions.tsx` (reachable only via CylinderScan-mode nav, and is a `cylinderScanSteps` Setup item) and its subcomponents `AccessionForm.tsx`, `AccessionList.tsx`, `AccessionFileUpload.tsx` all carry the same `focus:ring-blue-500`/button-blue pattern as the already-in-scope `ExperimentChooser.tsx`/`PhenotyperChooser.tsx` — same treatment, same zero-GraviScan-impact reasoning (these components are never imported by any GraviScan code path).

**Revision 2 addition — shared entity forms:** `ExperimentForm.tsx`, `PhenotyperForm.tsx`, `ScientistForm.tsx` (reachable from both scan modes via the always-visible Scientists/Phenotypers/Experiments pages) carry the identical `focus:ring-blue-500` idiom as `ExperimentChooser`/`PhenotyperChooser`. Since `BrowseScans.tsx`/`ScanPreview.tsx` (also shared, both-mode) are already in scope under the same "shared pages get the same treatment" reasoning, excluding these three forms with no stated rationale would have been inconsistent — they're now in scope too.

**Revision 3 addition — `MachineConfiguration.tsx`:** round-2 code-feasibility review found 13 unaddressed `blue-*` instances in this file (`:249,265,299,328,350,372,388,487,542,587,654,687,714` — checkboxes, text/number inputs, and two submit buttons). Unlike `ConfigureScanner.tsx` (correctly excluded — gated `mode === 'graviscan'` only in `App.tsx`), `MachineConfiguration.tsx` is registered as an unconditional route reachable from both modes (confirmed via `App.tsx`, `Layout.tsx`'s global Ctrl+Shift+, shortcut, and `Home.tsx`'s mode-agnostic first-run redirect) — squarely the same "shared, both-mode file" category as `BrowseScans.tsx`/`ScanPreview.tsx`/the three entity forms, and is now in scope with the same treatment.

### Decision: green stays green; `ConfigureScanner.tsx` stays untouched

Unchanged from Revision 1 — see proposal.md's "Explicitly out of scope."

### Decision: `WorkflowSteps.tsx` stays untouched — the Daily/Setup restructure is a new, CylinderScan-only component (Revision 4)

Revision 3 planned to change `WorkflowSteps.tsx`'s own `WorkflowStep` interface and rendering logic (adding `section`/`primary`, dropping the numbered badge) and apply it to both `cylinderScanSteps` and `graviScanSteps`. Revision 4 abandons touching the shared file's behavior at all, given #289/#290's active edits to it:

- A new component, `src/renderer/components/CylinderScanWorkflowGuide.tsx`, owns the Daily-Workflow/Setup structure and its own step data (moved out of `WorkflowSteps.tsx`'s `cylinderScanSteps` export, which is deleted as dead code once this lands):
  - Daily Workflow (prominent, no step numbers): Camera Settings (`/camera-settings`, "confirm/verify before each session" copy per #175), Capture Scan (`/capture-scan`, rendered as the single large primary CTA), Browse Scans (`/browse-scans`, secondary).
  - Setup (less prominent, unordered cards, no step numbers): Scientists, Phenotypers, Accessions, Experiments — same routes/copy as today.
  - Uses `workflow-step-${id}` slug testids (e.g. `workflow-step-capture-scan`) — a new scheme, but scoped entirely to this new component, so it doesn't collide with anything `graviScanSteps`/`WorkflowSteps.tsx` consumers (including #290's own new test, which references the _old_ numeric `workflow-step-3` against `graviScanSteps` — a file/testid this change no longer touches at all).
- `WorkflowSteps.tsx` itself — the `WorkflowStep` interface, the `WorkflowSteps` component's rendering logic, `graviScanSteps`, and its numbered flat-list markup (including the `bg-blue-600` badge and `hover:bg-blue-50` hover, which stay blue, not lime) — is **completely unchanged**. The only edit to this file is removing the now-unused `cylinderScanSteps` export, a pure deletion with no logic change.
- `Home.tsx` renders `<CylinderScanWorkflowGuide />` in `cylinderscan` mode and continues rendering `<WorkflowSteps steps={graviScanSteps} />`, exactly as today, in `graviscan` mode.

This achieves genuine zero-GraviScan-impact — not just "GraviScan's data is unaffected" (Revision 3's mitigation, via tests) but "GraviScan's rendering code path is not touched by this change at all," which is a stronger and simpler guarantee given #289/#290's active, ongoing edits to the exact file Revision 3 would have modified.

**Follow-up:** applying this same Daily/Setup structure to `graviScanSteps` (per #175's "applies to both modes" text) is deferred — see "Deferred Scope" above.

### Decision: Home "Today's Activity" widget reuses `db:scans:getRecent` as-is (today-scoped), framed honestly

`db:scans:getRecent` (`src/main/database-handlers.ts:1862-1926`) filters to `capture_date` within \[today 00:00, tomorrow 00:00) — it is not a generic "last N scans ever" query, despite `CaptureScan.tsx`'s existing "Recent Scans" widget using the same call. Rather than changing this shared handler's date-scoping semantics (which would also change `CaptureScan.tsx`'s existing widget's behavior, out of scope here), the Home dashboard's widget is explicitly framed as **"Today's Activity,"** matching what the data actually represents, and reuses the handler unchanged apart from one additive `include` extension (below).

`getRecent`'s current `include` (`experiment: { select: { name: true } }`) has no `images` at all — insufficient for an upload-status breakdown. Extending it to `images: { select: { status: true } }` is additive (checked: no existing test asserts the old shape; `CaptureScan.tsx`'s consumption of this call only reads named fields it already expects, so an extra `images` array is inert to it). Separately (flagged by round-2 code-feasibility review, not fixed by this change): `src/types/electron.d.ts`'s declared return type for `getRecent` already claims full `ScanWithRelations`/`images: true` inclusion — a **pre-existing** mismatch against the real query, which includes no images at all today. `tasks.md`'s type-update task explicitly flags this so an implementer doesn't conclude "the type already covers images, nothing to do" without noticing the type was already wrong before this change.

**Revision 3 correction — `upload-status.ts`'s shape (round-2 TDD and scientific-rigor review both independently flagged the original plan as broken):** the original plan ("extract `getUploadStatus()` verbatim, reuse it in both places") cannot work — `BrowseScans.tsx`'s `getUploadStatus(images)` is a **per-scan** function that picks one prioritized label (`"N failed"` / `"X/Y uploaded"` / `"All uploaded"` / `"X/Y"` / `"No images"`) and discards the other categories' counts once one branch wins; it has no way to produce the Home widget's **cross-scan aggregate** three-way count. The corrected design: `src/utils/upload-status.ts` exports a low-level `countUploadStatuses(images: { status: string }[]): { pending: number; failed: number; uploaded: number }` (note: no `id` field required, so it works for both `BrowseScans.tsx`'s `{id, status}` images and `getRecent`'s `{status}`-only images). `BrowseScans.tsx`'s existing per-scan label logic is rewritten to call `countUploadStatuses()` internally, then apply its existing priority rules to produce the same label it does today (behavior-preserving refactor). The Home widget separately sums `countUploadStatuses()` across every scan returned by `getRecent` to produce the true cross-scan aggregate the "Today's Activity" requirement asks for.

"Failed uploads needing attention" (today-scoped) surfaces as a link to `/browse-scans` when the aggregate failed count > 0 for today's scans — a plain navigation link, not a filtered deep link (BrowseScans has no upload-status query filter today; adding one is out of scope for this tier).

### Decision: a separate, date-unscoped failed-upload indicator (Revision 3, per user decision)

Round-2 GitHub-alignment review found a real gap: "Today's Activity" is today-scoped by design (see above), so a failed upload from a prior day — still unresolved — would surface no alert at all on a day with no new captures, undercutting #104's "failed uploads needing attention" as a first-class ask. Rather than widening `getRecent`'s date filter (which would also change `CaptureScan.tsx`'s existing widget's semantics, out of scope), this adds one small, separate, date-unscoped check: a new `db:scans:getFailedUploadCount` IPC handler returning `{ failedCount: number }`, computed as `db.image.count({ where: { status: 'failed', scan: { deleted: false } } })` — a single cheap count query, not a row fetch. The Home dashboard calls this in addition to `getRecent`, and shows a persistent "N failed uploads need attention" banner/link (to `/browse-scans`) whenever `failedCount > 0`, regardless of whether anything was captured today. This is a genuinely new IPC handler (unlike the rest of this change's read-path extensions), so it is subject to the IPC coverage gate (CI's 90% gate scanning `tests/e2e/renderer-database-ipc.e2e.ts` for `db:*` handler calls) — `tasks.md` includes real E2E coverage for it, not just a unit test.

### Decision: "Contact your administrator" copy, no Machine Config link

#104 explicitly requires: if a system component (camera/DAQ) is down, show "Contact your administrator" — do NOT link to Machine Configuration (admin-only, one-time setup). Verified directly: `PythonStatus.tsx` today has no Machine Config link anywhere, so this requirement is already met structurally — this change adds the explicit "Contact your administrator" copy to the hardware-unavailable state and an explicit regression-guard test asserting no Machine Config link is ever rendered from this component, rather than leaving the absence of a link as an untested accident.

### Decision: #107's Scanner Name via the compact-summary approach, not a new column or config UI

#107 offers two alternatives ("optional/toggleable columns" or "a column configuration UI") and one hard constraint ("table remains readable without horizontal scrolling"). The compact-summary-with-tooltip design already chosen for Exposure/Gain (Revision 1) extends naturally to include Scanner Name (`scan.scanner_name`, already a plain `Scan` scalar field, zero query cost) without adding three more always-visible columns or building toggle-column infrastructure — better satisfying the "no horizontal scrolling" constraint than either suggested alternative would, while still surfacing all three pieces of data the issue asks for.

### Decision: `Layout.tsx` shell/sidebar recolor — deferred, not implemented (Revision 4)

Revisions 1-3 treated `Layout.tsx`'s shell background and sidebar nav-link as an explicit, approved cross-mode exception to the "don't touch unrelated gray chrome" rule. Revision 4 defers both entirely — see "Deferred Scope" above. The reasoning for _why_ this would be a reasonable exception (once made) is preserved in the pilot-mapping table above for the follow-up; this change makes no edits to `Layout.tsx` at all.

### Decision: thumbnail data flow — extend the existing list query; explicit size; explicit lazy-loading

Unchanged core decision from Revision 1 (extend `db:scans:list`'s `images` select rather than a new handler or N+1 fetch). Two refinements from review:

- **Size**: #106 suggests 48×48 or 64×64px; this proposal specifies **48×64px** (matching typical scan-image aspect ratio rather than a square crop) as the concrete target — implementer should adjust to whichever reads better once real images are on screen, per the same shade-tuning judgment-call precedent as the color work below.
- **Lazy loading**: the `loading="lazy"` attribute is now an explicit task (`tasks.md`), not just descriptive prose — TDD review found the original spec text asserted lazy-loading with no task or test driving it.

**Risk re-assessment (per TDD review):** design.md's Revision 1 flagged "hunt down and update any test asserting the old `{id,status}`-only shape" as the highest risk item. A direct search found **no such test exists** — this is stated here plainly rather than left as an open action item implying a real landmine.

### Decision: `BrowseScans List View` drift is preserved, not reconciled, by this change

The archived `ui-management-pages` spec's "BrowseScans List View" requirement already predates several undocumented drifts from the live app (route text says `/scans`, live route is `/browse-scans`; column list says "Frame Count," the live table also already shows Wave/Age/Upload Status). Revision 1 silently absorbed this drift while editing the requirement to add the new columns, which spec-quality review correctly flagged — a MODIFIED requirement must reflect only what _this_ change actually modifies, not quietly overwrite an unrelated stale baseline. Revision 2's MODIFIED delta pastes the requirement's literal current text and adds only the two new columns (thumbnail, camera-settings summary) this change actually introduces, leaving the route/Frame-Count/Wave/Age drift exactly as stale as it already was — with an explicit note in the spec delta itself pointing at this decision, so a future reader doesn't mistake the preserved drift for something this change introduced or endorsed. Reconciling that pre-existing drift is left as a candidate for its own small follow-up change.

### Decision: coordination with Tier 2 on `BrowseScans.tsx`

Unchanged from Revision 1 — see `tasks.md` for the pre-merge diff-check plan against `c:\repos\bloom-desktop-tier2-delete-upload-integrity`.

### Decision: `BrowseScans.tsx`'s new test file backfills baseline coverage, not just the new columns

`BrowseScans.tsx` has zero existing test coverage (unit or E2E) today. Since this change creates its first test file while also touching its spec (`BrowseScans List View` → split into three requirements), the new test file adds baseline coverage (table renders with expected columns, empty state, pagination controls present) alongside the new thumbnail/camera-settings-column tests, rather than leaving the pre-existing scenarios untested by coincidence of timing.

## Risks / Trade-offs

- **`CylinderScanWorkflowGuide.tsx`'s introduction is the largest single change in this tier**, though smaller in blast radius than Revision 3's plan since it's a new, isolated component rather than a rewrite of the shared `WorkflowSteps.tsx`. Mitigated by tests asserting its rendering (both sections, correct routes, primary CTA) and a manual visual check of CylinderScan's Home screen before merge. GraviScan's Home screen is unaffected by construction (its render path — `WorkflowSteps.tsx`/`graviScanSteps` — isn't touched), not just by testing.
- **Shade/contrast tuning and thumbnail aspect ratio are judgment calls**, not fully fixed by this spec — real-browser legibility should be eyeballed during the dev-server visual check in `tasks.md`.
- **Two Prisma `include`/`select` extensions now** (`db:scans:list`'s paginated branch, `db:scans:getRecent`), both additive-only reads, both verified against existing tests with no shape-assertion conflicts found.
- **Cross-mode blast radius is now larger than Revision 1** (structural, not just color) — mitigated by the explicit both-modes tests described above and a manual visual/functional check of GraviScan's Home screen before merge.
- **Sequencing risk with #289/#290** (Revision 3's concern) — resolved in Revision 4 by narrowing scope so this change makes zero edits to the files those PRs are actively rewriting (`Layout.tsx`, `WorkflowSteps.tsx`'s `graviScanSteps` path), rather than waiting for them to merge.
- **One genuinely new IPC handler** (`db:scans:getFailedUploadCount`, Revision 3) — small surface (one count query), but subject to the IPC coverage gate; `tasks.md` includes real E2E coverage for it.

## Migration Plan

None needed — UI/query-shape change only, no data migration, no schema change. Revertible via `git revert`.

## Open Questions

None outstanding. All Revision-2 scope questions (full #175 restructure across both modes; #104's recent-activity widget; #107's Scanner Name column), both Revision-3 questions (sequencing against #289/#290; the date-unscoped failed-upload indicator), and the Revision-4 narrowing decision (defer `Layout.tsx` and `graviScanSteps`'s restructure rather than keep waiting) were explicitly decided with the user before the respective revision was written. The one open **action item** is filing the deferred-scope follow-up issue for GraviScan's equivalent work once #289/#290 settle.
