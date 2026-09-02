# Fix Layout Sidebar/Nav Parity (#328, #337)

## Why

CylinderScan Tier 4 (`add-cylinderscan-style-ux-parity`) originally scoped two
GraviScan-touching pieces of work, then deferred both in its Revision 4
specifically because GraviScan PRs #289 ("Core Scan-Operation screen") and
#290 ("Browse / Experiment Detail / Metadata UI") were both actively
rewriting `src/renderer/Layout.tsx` / `src/renderer/components/WorkflowSteps.tsx`
at the time — building against them would have collided. Both PRs have since
merged (#289 → `c8d3ea9`, 2026-08-25; #290 → `ad851ac9`, 2026-08-31, both
verified via `gh pr view --json state,mergedAt`), unblocking this work. Issue
#328 tracks picking the deferred pieces back up; issue #337, filed after a
manual walkthrough of Tier 4's PR #329, flags that the sidebar's link
ordering doesn't match the Daily-Workflow-first structure Tier 4 established
on Home.

Both issues are scoped to the same file (`Layout.tsx`) for the same
underlying reason (Tier 4's deferral) — bundled into one change to avoid two
proposals landing avoidable merge friction on the same file.

## What Changes

**#328 piece 1 — cross-mode shell/sidebar recolor:**

- `Layout.tsx`'s shell background: `bg-gray-50` → `bg-stone-100`.
- Sidebar panel is unified into the stone shell rather than remaining a
  separate white panel: `bg-white shadow-lg` → `bg-stone-100 border-r
border-stone-200`.
- Sidebar nav-link colors now match `salk-bloom`'s (the production web app
  bloom-desktop uploads scans to) actual convention, read directly from its
  source rather than extrapolated: base `text-gray-700` → `text-stone-700`;
  hover `hover:bg-blue-50 hover:text-blue-600` → `hover:bg-stone-50/70
hover:text-stone-900` (hover no longer previews the active color); active
  `bg-blue-50 text-blue-600 border-r-4 border-blue-600` → `bg-stone-50
text-lime-700 font-medium` (no border accent). An earlier revision of
  this proposal invented a hover-turns-lime, border-accent-on-active
  pattern that was internally contrast-correct but never checked against
  `salk-bloom` itself — this revision replaces it with `salk-bloom`'s real
  classes; see `design.md`'s "Revision 2" for the full comparison and why
  `lime-700` (not `lime-800`) is still contrast-safe against the new,
  lighter `bg-stone-50` background (≈4.79:1, clears WCAG AA). A subsequent
  `/review-pr` round caught that the hover class had shipped at full
  opacity (`hover:bg-stone-50`) rather than `salk-bloom`'s literal `/70`
  opacity — fixed to match exactly.
- This is cross-mode by design (both scan modes share `Layout.tsx`'s shell)
  and was already user-approved as an intentional, visible change to
  GraviScan's shell too, back when Tier 4 first scoped it.

**#328 piece 2 — GraviScan workflow-guide restructure:**

- A new, standalone `GraviScanWorkflowGuide.tsx`, mirroring the existing
  `CylinderScanWorkflowGuide.tsx` pattern exactly: a prominent "Daily
  Workflow" section (Configure Scanner, Capture Scan as the primary CTA,
  Browse GraviScans) and a less-prominent "Setup" section (Scientists,
  Phenotypers, Metadata, Experiments). Capture Scan's and Experiments'
  descriptions are generalized, not carried over verbatim from the retired
  `graviScanSteps` data — the old text described both in gravitropism-only
  terms, but GraviScan scanners run other kinds of studies too. A
  subsequent `/review-pr` round found this fix had shipped with no
  regression test on either side (old or new copy) — closed with explicit
  assertions in `GraviScanWorkflowGuide.test.tsx`.
- `Home.tsx` renders `<GraviScanWorkflowGuide />` in `graviscan` mode instead
  of `<WorkflowSteps steps={graviScanSteps} />`. `WorkflowSteps.tsx`'s
  `graviScanSteps` export and the `WorkflowStep` interface become dead code
  and are removed once confirmed unused elsewhere; the `WorkflowSteps`
  component itself is removed only if nothing else renders it after this
  change (checked directly, not assumed, during implementation).
- "Configure Scanner" lands in Daily Workflow, not Setup — verified directly
  via GitHub issue #230 (stale scanner rows persist after USB
  reconfiguration, blocking a valid config state with no in-app fix), with
  #182 and #228 as supporting context on general scanner fragility (not
  direct evidence for this placement — #245 was dropped as a citation
  entirely after round-1 review found it names an unrelated feature). Copy
  is condition-specific ("Check scanner detection and connection health —
  especially after moving cables or a prior scan failure"), not a blanket
  "every session" framing, to avoid alert fatigue on the days nothing was
  actually touched.

**#337 — sidebar link-ordering parity, both modes:**

- CylinderScan mode: Home, Camera Settings, Capture Scan, Browse Scans,
  Export Scans, then Setup: Scientists, Phenotypers, Accessions,
  Experiments.
- GraviScan mode (newly ordered, since GraviScanWorkflowGuide.tsx above is
  what first establishes a Daily/Setup split for GraviScan to order
  against): Home, Configure Scanner, Capture Scan, Browse GraviScans, then
  Setup: Scientists, Phenotypers, Metadata, Experiments.
- Both modes are addressed in this same change (not just CylinderScan, as
  #337 originally suggested) — see `design.md`'s "Decisions" for why.

## Explicitly Out of Scope

- GraviScan's "Test Scan" pre-session hardware-verification feature already
  exists (`useTestScan.ts`, `ScanControlSection.tsx`, `ui-management-pages`'s
  "GraviScan Test Scan" requirement) — not a gap, not touched here.
- GraviScan's plate-assignment auto-fill/manual-override UX already exists
  as a substantial feature (`ui-management-pages`'s "GraviScan Plate
  Assignment Auto-Fill and Manual Override" requirement) — not touched here.
- No IPC/backend changes of any kind — this change is renderer-only
  (`Layout.tsx`, `WorkflowSteps.tsx`, a new `GraviScanWorkflowGuide.tsx`,
  `Home.tsx`), so the IPC coverage gate (CI's 90% gate scanning
  `tests/e2e/renderer-database-ipc.e2e.ts`) does not apply.
- No route is added, removed, or changed for either scan mode — this change
  governs grouping, ordering, and color only.

## Impact

- Affected specs: `ui-color-palette` (ADDED requirement — the
  cross-mode shell/sidebar palette this spec's own trailing note already
  flagged as deferred; MODIFIED "Shared Scan-Management and Entity-Form
  Accent Color Convention" — spec-text cleanup only, removing the
  now-satisfied deferred-note blockquote, no code task attached, since that
  requirement's actual scenario — including `ScanPreview.tsx` — was already
  implemented by a prior change), `ui-management-pages` (ADDED "GraviScan
  Workflow Guide Structure" requirement, ADDED "Sidebar Navigation Ordering"
  requirement, MODIFIED "CylinderScan Workflow Guide Structure" to remove
  its now-stale "GraviScan's equivalent restructure is explicitly deferred"
  note).
- Affected code: `src/renderer/Layout.tsx`, `src/renderer/components/WorkflowSteps.tsx`,
  new `src/renderer/components/GraviScanWorkflowGuide.tsx`, `src/renderer/Home.tsx`.
- Affected tests: `tests/unit/pages/Layout.test.tsx` (new ordering/color
  assertions for both modes), new `tests/unit/components/GraviScanWorkflowGuide.test.tsx`,
  `tests/unit/pages/Home.test.tsx` (graviscan-mode assertions updated for
  the new component, mirroring how Tier 4 updated its cylinderscan-mode
  assertions), `tests/unit/pages/App.test.tsx` (a `workflow-step-1`
  regression-guard assertion becomes vacuous once numeric testids retire —
  needs replacing, not just leaving to silently pass for the wrong reason),
  `tests/e2e/graviscan-browse-metadata.e2e.ts` (a hard-coded
  `workflow-step-3` selector will break outright and needs updating to the
  new slug scheme).
- Follow-up (not fixed by this change, filed as a new issue per `tasks.md`
  §7): `ConfigureScanner.tsx`'s "Reset USB" and per-scanner "Remove" actions
  have no confirmation-dialog guard — found during review, worth addressing
  given this change increases how often operators are prompted toward that
  page.
- Closes #328, #337.
