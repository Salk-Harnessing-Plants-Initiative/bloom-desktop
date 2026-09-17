## ADDED Requirements

### Requirement: GraviScan Wedge-Response Real-Hardware Validation Evidence Is Recorded

Before the GraviScan wedge auto-pause/retry feature (`scanning` capability's "GraviScan Wedge Auto-Pause on Detection", "GraviScan Wedge Event Forwarding to Renderer", and "GraviScan Retry-Scanner Action" requirements) is relied upon for an unattended multi-day production run, evidence that its bench-testable behaviors have been validated against real V600 hardware SHALL be recorded in a discoverable location. This requirement covers evidence/recording completeness only — it does not change or restate the underlying feature behavior, which is already specified in the `scanning` capability, and it does not mandate a specific validation outcome. Each checklist item SHALL be recorded with one of **passed**, **failed**, **blocked** or **not executed**; a failed item is recorded, not withheld, and a blocked or not-executed item SHALL be recorded together with its specific cause and what would unblock it. A blocked or not-executed item SHALL NOT be recorded as passed, and SHALL NOT be treated as satisfied by a substitute scenario unless that substitution is stated.

#### Scenario: Bench-test checklist results are recorded

- **WHEN** a developer looks for evidence that the wedge auto-pause/retry feature was validated against real hardware
- **THEN** a comment on issue #279 records, for every bench-test checklist item, an outcome of passed, failed, blocked or not executed, naming the commit tested
- **AND** every passed or failed item carries enough detail to reproduce, and every blocked or not-executed item names its cause
- **AND** the same findings are recorded in the GraviScan rig-test vault per this project's existing empirical-findings convention

#### Scenario: Production-rig-specific validation is tracked as its own gate, not silently substituted or lost when the parent issue closes

- **WHEN** a developer looks for the multi-hour continuous-session validation that issue #279 specifies must run on the production rig
- **THEN** documentation SHALL show that item is tracked as its own separate issue (#364), whose resolution is independent of #279's — closing #279 SHALL NOT be treated as closing it
- **AND** it SHALL NOT be silently satisfied by a dev-rig substitute without that substitution being stated
- **AND** any gating mechanism that depends on this validation (e.g. a production-cutover roadmap's hard-block list) SHALL reference the separate tracking issue directly, not only the parent issue whose closure does not imply this item is done
