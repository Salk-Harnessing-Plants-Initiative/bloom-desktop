## ADDED Requirements

### Requirement: Lime/Stone/Amber Accent Color Convention

CylinderScan-only pages and components SHALL use a lime/stone/amber accent convention (adapted from `bloom-desktop-pilot`'s verified usage to bloom-desktop's existing shade-hover interaction pattern) in place of blue/indigo accents, for primary buttons, links, and focus rings.

#### Scenario: Primary buttons and links use lime

- **GIVEN** a CylinderScan-only file previously using blue accents (`CaptureScan.tsx`'s "Go to Camera Settings" link and "Configure Camera" button, `PythonStatus.tsx`'s "Check Hardware" button, `AccessionList.tsx`'s row-action buttons)
- **WHEN** the element renders
- **THEN** buttons SHALL use `bg-lime-700 text-white hover:bg-lime-800`
- **AND** links SHALL use `text-lime-700 hover:text-lime-800`
- **AND** no `blue-*`/`indigo-*` classes SHALL remain on these elements

**Acceptance Criteria**:

- `CaptureScan.tsx`'s green "Start Scan" button and success banner are unaffected (explicitly out of scope — green is not being replaced)
- `ConfigureScanner.tsx` (GraviScan-only) is unaffected — not part of this convention

#### Scenario: Focus rings use lime

- **GIVEN** `ExperimentChooser.tsx`, `PhenotyperChooser.tsx` (used only via `MetadataForm.tsx`, which only `CaptureScan.tsx` imports), and `Accessions.tsx`'s subcomponents `AccessionForm.tsx`, `AccessionList.tsx`, `AccessionFileUpload.tsx` (all reachable only via CylinderScan-mode navigation)
- **WHEN** a select/input/button element in these files receives focus
- **THEN** it SHALL use `focus:ring-lime-500` in place of `focus:ring-blue-500`

**Acceptance Criteria**:

- This is a novel focus-ring convention (not attested in the pilot, which uses no visible focus ring anywhere) — a deliberate extrapolation, not a literal port
- No GraviScan component imports `ExperimentChooser`/`PhenotyperChooser`/`MetadataForm`/`Accessions`/its subcomponents, so this change has zero GraviScan impact

#### Scenario: Warning-state borders remain amber (no change needed)

- **GIVEN** `ExperimentChooser.tsx`/`PhenotyperChooser.tsx`'s empty-select state and `CaptureScan.tsx`'s warning banners
- **WHEN** the element is in its "needs attention" state
- **THEN** it SHALL continue using `border-amber-300`/`bg-amber-*` as it already does today

#### Scenario: CylinderScanWorkflowGuide uses the lime convention natively (new component, not a recolor)

- **GIVEN** the new `CylinderScanWorkflowGuide.tsx` component (CylinderScan-only, replacing `cylinderScanSteps`'s rendering via the shared `WorkflowSteps` component — see `ui-management-pages`'s "CylinderScan Workflow Guide Structure" requirement)
- **WHEN** it renders
- **THEN** its Daily Workflow primary card SHALL use `bg-lime-700 text-white hover:bg-lime-800`
- **AND** its Setup section's unordered cards SHALL use the same lime/stone conventions as this requirement's other elements

**Acceptance Criteria**:

- This is a brand-new component's own styling, not a recolor of an existing blue element — there is no "before" state to convert
- The shared `WorkflowSteps.tsx` component (used only by `graviScanSteps` after this change) is untouched and keeps its current blue accents — deferred, see `design.md`'s "Deferred Scope"

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

> **Deferred (not part of this change):** a "Cross-Mode Shell, Sidebar, and Workflow-Guide Palette" requirement — recoloring `Layout.tsx`'s shell background/sidebar nav-link state — was planned in an earlier revision and is deferred to a follow-up, since `Layout.tsx` is being actively rewritten by concurrent, unrelated PRs. See `design.md`'s "Deferred Scope."
