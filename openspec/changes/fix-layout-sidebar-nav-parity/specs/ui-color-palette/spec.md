## ADDED Requirements

### Requirement: Cross-Mode Shell, Sidebar, and Workflow-Guide Palette

`Layout.tsx`'s shell background and sidebar nav-link hover/active states, shared by both CylinderScan and GraviScan modes, SHALL use a lime/stone accent convention in place of their current gray/blue treatment.

#### Scenario: Shell background is stone, not gray

- **GIVEN** `Layout.tsx` renders, in either scan mode
- **WHEN** the outer shell container renders
- **THEN** it SHALL use `bg-stone-100` in place of `bg-gray-50`

#### Scenario: Sidebar nav-link hover and active states use a lime-accented treatment, adapted (not a literal port) from the pilot

- **GIVEN** a sidebar nav link in either scan mode
- **WHEN** the link is hovered
- **THEN** it SHALL use `hover:bg-stone-100 hover:text-lime-800` in place of
  `hover:bg-blue-50 hover:text-blue-600`
- **WHEN** the link's route is the active route
- **THEN** it SHALL use `bg-stone-200 text-lime-800 border-r-4 border-lime-800`
  in place of `bg-blue-50 text-blue-600 border-r-4 border-blue-600`

**Acceptance Criteria**:

- This is an adaptation, not a literal port of `bloom-desktop-pilot`'s
  `Layout.tsx:207-211`, which uses only a bare `bg-stone-200` on active with
  no text-color or border change — this convention deliberately keeps
  today's two existing UX affordances (colored hover feedback, a persistent
  active-route border indicator), recolored to lime/stone, rather than
  adopting the pilot's flatter style and losing them.
- `lime-800` (not `lime-700`) is used specifically for WCAG AA contrast
  compliance: computed against Tailwind's default palette hex values using
  the standard relative-luminance formula, `text-lime-700` on `bg-stone-200`
  is ≈3.98:1 — below the 4.5:1 minimum for normal-size text. `text-lime-800`
  on `bg-stone-200` computes to ≈5.64:1 (active state), and `text-lime-800`
  on `bg-stone-100` computes to ≈6.49:1 (hover state) — both comfortably
  clear AA. This is a computed decision, not a subjective eyeball call; the
  manual dev-server visual check in `tasks.md` confirms real-browser
  rendering matches this computation, it does not substitute for it.
- Applies identically in CylinderScan mode, GraviScan mode, and the
  default/no-mode state — `Layout.tsx` has no mode-conditional styling for
  the shell background or nav-link hover/active classes.

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
