## ADDED Requirements

### Requirement: GraviScan Wedge-Response Real-Hardware Validation Evidence Is Recorded

Before the GraviScan wedge auto-pause/retry feature (`scanning` capability's "GraviScan Wedge Auto-Pause on Detection", "GraviScan Wedge Event Forwarding to Renderer", and "GraviScan Retry-Scanner Action" requirements) is relied upon for an unattended multi-day production run, evidence that its bench-testable behaviors have been validated against real V600 hardware SHALL be recorded in a discoverable location. This requirement covers evidence/recording completeness only — it does not change or restate the underlying feature behavior, which is already specified in the `scanning` capability, and it does not mandate a specific validation outcome (a failed checklist item is still recorded, not withheld).

#### Scenario: Bench-test checklist results are recorded

- **WHEN** a developer looks for evidence that the wedge auto-pause/retry feature was validated against real hardware
- **THEN** a comment on issue #279 records pass/fail results for each bench-test checklist item, with enough detail to reproduce
- **AND** the same findings are recorded in the GraviScan rig-test vault per this project's existing empirical-findings convention

#### Scenario: Production-rig-specific validation is tracked as its own gate, not silently substituted or lost when the parent issue closes

- **WHEN** a developer looks for the multi-hour continuous-session validation that issue #279 specifies must run on the production rig
- **THEN** documentation SHALL show that item is tracked as its own separate, still-open issue (#364) rather than closed alongside #279's other items
- **AND** it SHALL NOT be silently satisfied by a dev-rig substitute without that substitution being stated
- **AND** any gating mechanism that depends on this validation (e.g. a production-cutover roadmap's hard-block list) SHALL reference the separate tracking issue directly, not only the parent issue whose closure does not imply this item is done
