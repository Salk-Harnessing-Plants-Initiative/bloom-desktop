## ADDED Requirements

### Requirement: Scan Directory Path Format

The system SHALL generate scan output directories following the pilot-compatible format `YYYY-MM-DD/<plant_qr_code>/<scan_uuid>/` relative to the configured `scans_dir`. The date SHALL use the local timezone, the plant QR code SHALL be sanitized for filesystem safety, and the scan UUID SHALL guarantee uniqueness.

#### Scenario: Standard scan directory creation

- **GIVEN** the user starts a scan with plant QR code "PLANT-001"
- **AND** the local date is "2026-03-04"
- **AND** a scan UUID "abc-123-def" is generated
- **WHEN** the scan output directory is created
- **THEN** the directory path SHALL be `<scans_dir>/2026-03-04/PLANT-001/abc-123-def/`
- **AND** the `Scan.path` database field SHALL store the relative path `2026-03-04/PLANT-001/abc-123-def`

#### Scenario: Plant QR code with special characters is sanitized

- **GIVEN** the user starts a scan with plant QR code "PLANT/001..bad"
- **WHEN** the scan output directory path is built
- **THEN** the plant QR code segment SHALL be sanitized to a filesystem-safe string
- **AND** path traversal sequences SHALL be removed
- **AND** only alphanumeric characters, hyphens, underscores, and periods SHALL be retained

#### Scenario: Date uses local timezone

- **GIVEN** the user starts a scan at 11:30 PM local time on March 4th
- **AND** the UTC date has already rolled over to March 5th
- **WHEN** the date segment of the scan path is generated
- **THEN** the date SHALL be "2026-03-04" (local date, not UTC)

#### Scenario: Scan path stored as relative path

- **GIVEN** a scan completes successfully
- **WHEN** the scan record is created in the database
- **THEN** `Scan.path` SHALL contain the relative path (e.g., `2026-03-04/PLANT-001/abc-123-def`)
- **AND** the path SHALL NOT include the `scans_dir` prefix
- **AND** the full absolute path SHALL be reconstructable by joining `scans_dir` with `Scan.path`
