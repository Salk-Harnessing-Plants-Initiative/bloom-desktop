## ADDED Requirements

### Requirement: Date Filter Validation

The system SHALL validate date filter inputs in the scan list handler. Malformed date strings SHALL be rejected with a descriptive error message rather than producing invalid Date objects.

#### Scenario: Malformed date rejected

- **WHEN** a malformed date string (e.g., `'not-a-date'`) is passed as dateFrom or dateTo
- **THEN** the system returns an error response with a descriptive message

#### Scenario: Valid date accepted

- **WHEN** a valid ISO date string (e.g., `'2025-02-17'`) is passed as dateFrom
- **THEN** the system parses it correctly and filters scans accordingly
