## ADDED Requirements

### Requirement: GraviScan Workflow Guide Structure

GraviScan's Home page SHALL present its workflow guide via a dedicated `GraviScanWorkflowGuide` component (not the shared `WorkflowSteps` component) with a two-section structure — a prominent "Daily Workflow" section and a less-prominent, unordered "Setup" section — in place of the prior single flat numbered list (`graviScanSteps`).

#### Scenario: GraviScan's Daily Workflow and Setup sections

- **GIVEN** the user is in GraviScan mode and navigates to the Home page
- **WHEN** the workflow guide renders
- **THEN** a "Daily Workflow" section SHALL prominently display, in this
  order: Configure Scanner (verify scanner detection/connection health
  before each session), Capture Scan (rendered as the single large primary
  call-to-action), Browse GraviScans (secondary)
- **AND** a "Setup" section SHALL display, as unordered cards with no step
  numbers: Scientists, Phenotypers, Metadata, Experiments

**Acceptance Criteria**:

- No step numbers are shown in either section, matching
  `CylinderScanWorkflowGuide`'s convention.
- No route is added, removed, or changed — this requirement governs
  grouping/prominence only. "Configure Scanner" (`/configure-scanner`) is
  newly represented in the workflow-guide data for the first time (it was
  never added to `graviScanSteps` when the route was introduced), but the
  route itself already exists.
- Accent colors for this component are governed by `ui-color-palette`'s
  "GraviScanWorkflowGuide uses the lime convention natively" scenario, not
  this one.
- `WorkflowSteps.tsx`'s `graviScanSteps` export and shared rendering are
  retired by this change (see "CylinderScan Workflow Guide Structure"
  below) — this is no longer a deferred follow-up.

### Requirement: Sidebar Navigation Ordering

`Layout.tsx`'s sidebar SHALL order its links to match each scan mode's Daily-Workflow-first structure, as established by that mode's Home-page workflow guide, rather than an order that predates the workflow guide and has drifted from it.

#### Scenario: CylinderScan sidebar order matches Daily Workflow / Setup

- **GIVEN** the user is in CylinderScan mode
- **WHEN** the sidebar renders
- **THEN** links SHALL appear in this order: Home, Camera Settings, Capture
  Scan, Browse Scans, Export Scans, Scientists, Phenotypers, Accessions,
  Experiments

#### Scenario: GraviScan sidebar order matches Daily Workflow / Setup

- **GIVEN** the user is in GraviScan mode
- **WHEN** the sidebar renders
- **THEN** links SHALL appear in this order: Home, Configure Scanner,
  Capture Scan, Browse GraviScans, Scientists, Phenotypers, Metadata,
  Experiments

**Acceptance Criteria**:

- The default/no-mode sidebar order (Home, Scientists, Phenotypers,
  Experiments, Browse Scans, Export Scans) is unchanged by this requirement
  — no mode-specific Daily Workflow concept applies when no mode is set.
- No link is added, removed, or changes its route/label — ordering only.

## MODIFIED Requirements

### Requirement: CylinderScan Workflow Guide Structure

CylinderScan's Home page SHALL present its workflow guide via a dedicated `CylinderScanWorkflowGuide` component (not the shared `WorkflowSteps` component) with a two-section structure — a prominent "Daily Workflow" section and a less-prominent, unordered "Setup" section — in place of the prior single flat numbered list.

#### Scenario: CylinderScan's Daily Workflow and Setup sections

- **GIVEN** the user is in CylinderScan mode and navigates to the Home page
- **WHEN** the workflow guide renders
- **THEN** a "Daily Workflow" section SHALL prominently display, in this order: Camera Settings (confirm/verify before each session), Capture Scan (rendered as the single large primary call-to-action), Browse Scans (secondary)
- **AND** a "Setup" section SHALL display, as unordered cards with no step numbers: Scientists, Phenotypers, Accessions, Experiments

**Acceptance Criteria**:

- No step numbers are shown in either section — numbering previously implied a strict sequential order that doesn't reflect reality (Scientists/Phenotypers/Accessions/Camera-Settings setup tasks can be done in parallel)
- No route is added, removed, or changed — this requirement governs grouping/prominence only
- Accent colors for this component are governed by `ui-color-palette`'s "CylinderScanWorkflowGuide uses the lime convention natively" scenario, not this one
- GraviScan now has its own equivalent restructure — see the "GraviScan
  Workflow Guide Structure" requirement above. `graviScanSteps` and its
  rendering through the shared `WorkflowSteps` component are retired by
  this change, not merely "explicitly deferred" as previously noted here.
