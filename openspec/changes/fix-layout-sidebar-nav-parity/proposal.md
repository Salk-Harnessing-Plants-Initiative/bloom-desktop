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
- Sidebar nav-link hover/active state: `hover:bg-blue-50 hover:text-blue-600`
  / active `bg-blue-50 text-blue-600 border-r-4 border-blue-600` → a
  lime-accented equivalent (`hover:bg-stone-100 hover:text-lime-700` / active
  `bg-stone-200 text-lime-700 border-r-4 border-lime-700`) that preserves
  today's two UX affordances (colored hover feedback, a persistent border
  active-route indicator) rather than literally copying the pilot's flatter
  `bg-stone-200`-only style (verified directly against
  `bloom-desktop-pilot/app/src/renderer/Layout.tsx:207-211` — the pilot has
  no text-color or border change on its active nav item; the earlier
  `add-cylinderscan-style-ux-parity/design.md`'s "lime text/border
  equivalents" note was an extrapolation beyond the pilot, not a literal
  port — see `design.md`'s "Decisions" for the full reasoning).
- This is cross-mode by design (both scan modes share `Layout.tsx`'s shell)
  and was already user-approved as an intentional, visible change to
  GraviScan's shell too, back when Tier 4 first scoped it.

**#328 piece 2 — GraviScan workflow-guide restructure:**

- A new, standalone `GraviScanWorkflowGuide.tsx`, mirroring the existing
  `CylinderScanWorkflowGuide.tsx` pattern exactly: a prominent "Daily
  Workflow" section (Configure Scanner, Capture Scan as the primary CTA,
  Browse GraviScans) and a less-prominent "Setup" section (Scientists,
  Phenotypers, Metadata, Experiments).
- `Home.tsx` renders `<GraviScanWorkflowGuide />` in `graviscan` mode instead
  of `<WorkflowSteps steps={graviScanSteps} />`. `WorkflowSteps.tsx`'s
  `graviScanSteps` export and the `WorkflowStep` interface become dead code
  and are removed once confirmed unused elsewhere; the `WorkflowSteps`
  component itself is removed only if nothing else renders it after this
  change (checked directly, not assumed, during implementation).
- "Configure Scanner" lands in Daily Workflow, not Setup — verified via
  GitHub issues #182, #230, #245, #228 that GraviScan's USB scanners are
  fragile enough (device renumbering on failure, stale rows after
  reconfiguration, parallel-scan races) that Configure Scanner functions as
  the "verify hardware health before this session" step, the same role
  Camera Settings plays for CylinderScan — not a one-time setup task.

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
  flagged as deferred), `ui-management-pages` (ADDED "GraviScan Workflow
  Guide Structure" requirement, ADDED "Sidebar Navigation Ordering"
  requirement, MODIFIED "CylinderScan Workflow Guide Structure" to remove
  its now-stale "GraviScan's equivalent restructure is explicitly deferred"
  note).
- Affected code: `src/renderer/Layout.tsx`, `src/renderer/components/WorkflowSteps.tsx`,
  new `src/renderer/components/GraviScanWorkflowGuide.tsx`, `src/renderer/Home.tsx`.
- Affected tests: `tests/unit/pages/Layout.test.tsx` (new ordering/color
  assertions for both modes), new `tests/unit/components/GraviScanWorkflowGuide.test.tsx`,
  `tests/unit/pages/Home.test.tsx` (graviscan-mode assertions updated for
  the new component, mirroring how Tier 4 updated its cylinderscan-mode
  assertions).
- Closes #328, #337.
