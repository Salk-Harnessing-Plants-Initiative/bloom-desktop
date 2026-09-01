## ADDED Requirements

### Requirement: Cross-Mode Shell, Sidebar, and Workflow-Guide Palette

`Layout.tsx`'s shell background, sidebar panel, and sidebar nav-link hover/active states, shared by both CylinderScan and GraviScan modes, SHALL use a lime/stone accent convention matching `salk-bloom` (the production web app bloom-desktop uploads scans to), in place of their current gray/blue/white treatment.

#### Scenario: Shell background is stone, not gray

- **GIVEN** `Layout.tsx` renders, in either scan mode
- **WHEN** the outer shell container renders
- **THEN** it SHALL use `bg-stone-100` in place of `bg-gray-50`

#### Scenario: Sidebar panel is unified into the stone shell, not a separate white panel

- **GIVEN** `Layout.tsx` renders, in either scan mode
- **WHEN** the sidebar panel renders
- **THEN** it SHALL use `bg-stone-100 border-r border-stone-200` in place of
  `bg-white shadow-lg`, matching `salk-bloom`'s `<aside>` element
  (`web/app/app/layout.tsx`) rather than remaining a visually distinct panel

#### Scenario: Sidebar nav-link hover and active states match `salk-bloom`'s real convention, not an invented pattern

- **GIVEN** a sidebar nav link in either scan mode
- **WHEN** the link is not active and is hovered
- **THEN** it SHALL use `hover:bg-stone-50/70 hover:text-stone-900` in place
  of `hover:bg-blue-50 hover:text-blue-600` — hover SHALL NOT turn the text
  lime
- **WHEN** the link's route is the active route
- **THEN** it SHALL use `bg-stone-50 text-lime-700 font-medium` in place of
  `bg-blue-50 text-blue-600 border-r-4 border-blue-600` — the active state
  SHALL NOT use a border accent
- **GIVEN** any sidebar nav link, active or not
- **WHEN** it is not hovered or active
- **THEN** its base text color SHALL be `text-stone-700`, not `text-gray-700`

**Acceptance Criteria**:

- Verified directly against `salk-bloom/web/components/navigation.tsx` and
  `salk-bloom/web/app/app/layout.tsx`: `salk-bloom`'s real sidebar/nav
  convention is `bg-stone-100 border-r border-stone-200` for the panel,
  `text-stone-700 hover:bg-stone-50/70 hover:text-stone-900` for inactive/
  hover, and `bg-stone-50 text-lime-700 font-medium` (plus a small leading
  dot, not adopted here — see below) for active. This requirement matches
  that convention exactly, superseding an earlier, ungrounded design
  (lime text on hover, plus a border accent on active) that was checked
  against contrast math but never against `salk-bloom` itself.
- `salk-bloom`'s active-state also uses a small leading dot
  (`bg-stone-400`/`bg-lime-700`) as its "you are here" marker, since its nav
  links have no icons of their own. bloom-desktop's nav links already carry
  a per-link SVG icon serving that role — the dot is intentionally not
  ported, since a redundant marker alongside an existing icon would be
  clutter, not a faithful match. The `bg-stone-50`/`text-lime-700`/
  `font-medium` combination (the properties the dot itself reinforces, not
  substitutes for) is the part that is ported.
- `text-lime-700` (not `text-lime-800`) is contrast-safe specifically
  because the background changed alongside it: computed against Tailwind's
  default palette hex values using the standard relative-luminance formula,
  `text-lime-700` on `bg-stone-50` (`#fafaf9`) is ≈4.79:1 — clears the 4.5:1
  WCAG AA minimum for normal-size text (unlike the earlier, abandoned
  `text-lime-700` on `bg-stone-200` pairing, which failed at ≈3.98:1).
- Applies identically in CylinderScan mode, GraviScan mode, and the
  default/no-mode state — `Layout.tsx` has no mode-conditional styling for
  the shell background, sidebar panel, or nav-link hover/active classes.

#### Scenario: GraviScanWorkflowGuide uses the lime convention natively (new component, not a recolor)

- **GIVEN** the new `GraviScanWorkflowGuide.tsx` component (GraviScan-only,
  replacing `graviScanSteps`'s rendering via the shared `WorkflowSteps`
  component — see `ui-management-pages`'s "GraviScan Workflow Guide
  Structure" requirement)
- **WHEN** it renders
- **THEN** its Daily Workflow primary card (Capture Scan) SHALL use
  `bg-lime-700 text-white hover:bg-lime-800`
- **AND** its Setup section's unordered cards SHALL use the same lime/stone
  conventions as `CylinderScanWorkflowGuide.tsx`'s equivalent cards

**Acceptance Criteria**:

- This is a brand-new component's own styling, not a recolor of an existing
  blue element — there is no "before" state to convert, matching the
  precedent already set for `CylinderScanWorkflowGuide.tsx`.

## MODIFIED Requirements

### Requirement: Shared Scan-Management and Entity-Form Accent Color Convention

`BrowseScans.tsx`, `ScanPreview.tsx` (both rendered for scans captured in either scan mode), `ExperimentForm.tsx`, `PhenotyperForm.tsx`, `ScientistForm.tsx` (all reachable from both scan modes' Scientists/Phenotypers/Experiments pages), and `MachineConfiguration.tsx` (an unconditionally-registered route reachable from both modes, unlike the GraviScan-only `ConfigureScanner.tsx`) SHALL use the same lime accent convention for their existing blue links, buttons, checkboxes, and focus rings.

#### Scenario: Shared pages' and forms' blue elements convert to lime

- **GIVEN** `BrowseScans.tsx`'s date/experiment filter focus rings, "Upload Selected" button, Plant ID link, and row view-icon; `ScanPreview.tsx`'s "Back to Scans" links and Upload button; `ExperimentForm.tsx`/`PhenotyperForm.tsx`/`ScientistForm.tsx`'s input focus rings and submit buttons; and `MachineConfiguration.tsx`'s checkboxes, input focus rings, and submit buttons
- **WHEN** these elements render
- **THEN** they SHALL use the same lime button/link/focus-ring classes as the Lime/Stone/Amber Accent Color Convention requirement
- **AND** existing navigation/upload/filter/form-submission behavior on these pages is unchanged (styling-only)

**Acceptance Criteria**:

- No change to `BrowseScans.tsx`'s existing gray-toned chrome (`hover:bg-gray-50` row hover, `divide-gray-100`) — only the literal blue instances convert
- No change to `BrowseScans.tsx`'s upload-status indicator colors (`text-red-600`/`text-yellow-600`/`text-green-600`/`text-gray-*`, driven by `getUploadStatus()`) — these are data-state indicators, not accent colors, and are unaffected by this convention

Note: the "Cross-Mode Shell, Sidebar, and Workflow-Guide Palette" requirement
this note previously deferred is now implemented — see that ADDED
requirement above. The deferred-note blockquote that followed this
requirement is removed as part of this change. **This MODIFIED entry is
spec-text cleanup only** — its scenario describes behavior already shipped
by a prior change (`add-cylinderscan-style-ux-parity`); no task in this
change's `tasks.md` re-implements it, and none is needed.
