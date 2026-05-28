## ADDED Requirements

### Requirement: Per-Scanner grid_mode Persistence

The `graviscan:save-scanners-db` IPC handler SHALL persist the per-scanner `grid_mode` field on both Prisma UPDATE and CREATE operations.

- On UPDATE: the data block SHALL include
  `grid_mode: scanner.grid_mode ?? existing.grid_mode` so that
  payload values overwrite, but absent payload values preserve the
  current DB value (not the schema default).
- On CREATE: the data block SHALL include
  `grid_mode: scanner.grid_mode ?? '4grid'` so new rows accept a
  caller-supplied value but fall back to the schema default when
  unspecified.

Valid `grid_mode` values are `'2grid'` and `'4grid'` (see
`src/types/graviscan.ts`). The handler does not need to validate the
value at this layer — Prisma's `String` column accepts any string and
upstream code paths enforce the enum.

#### Scenario: UPDATE persists payload grid_mode

- **GIVEN** a `GraviScanner` row exists with `grid_mode='4grid'`
- **WHEN** `graviscan:save-scanners-db` is invoked with a payload
  whose entry for that scanner has `grid_mode: '2grid'`
- **THEN** after the call, the row's `grid_mode` SHALL be `'2grid'`
- **AND** `updatedAt` SHALL be advanced (Prisma @updatedAt)

#### Scenario: CREATE accepts payload grid_mode

- **GIVEN** no existing `GraviScanner` row for `usb_port='17-2'`
- **WHEN** `graviscan:save-scanners-db` is invoked with a payload
  whose entry has `usb_port='17-2'` and `grid_mode: '2grid'`
- **THEN** a new row SHALL be created with `grid_mode='2grid'`

#### Scenario: CREATE without grid_mode falls back to schema default

- **GIVEN** no existing `GraviScanner` row for `usb_port='17-1'`
- **WHEN** `graviscan:save-scanners-db` is invoked with a payload
  whose entry has `usb_port='17-1'` and NO `grid_mode` field
- **THEN** a new row SHALL be created with `grid_mode='4grid'`
  (the schema default)

#### Scenario: UPDATE without grid_mode preserves existing DB value

- **GIVEN** a `GraviScanner` row exists with `grid_mode='2grid'`
- **WHEN** `graviscan:save-scanners-db` is invoked with a payload
  whose entry for that scanner OMITS `grid_mode`
- **THEN** the row's `grid_mode` SHALL remain `'2grid'`

---

### Requirement: Stale GraviScanner Rows Are Disabled, Not Deleted

Two IPC handlers in `src/main/graviscan-handlers.ts` SHALL implement a
consistent disable-on-detect policy for stale `GraviScanner` rows:

1. **`graviscan:save-scanners-db`** — after upserting the payload
   rows, the handler SHALL set `enabled = false` on any existing
   `GraviScanner` row whose `usb_port` is NOT in the payload's
   `usb_port` set.
2. **`graviscan:validate-config`** — when validation detects an
   enabled row whose `usb_port` no longer enumerates, the handler
   SHALL `UPDATE enabled = false` rather than the current
   `DELETE` behavior (graviscan-handlers.ts:917-922).

Disabled rows are preserved in the DB so existing `GraviScan` and
`GraviScanPlateAssignment` rows referencing them via `scanner_id`
remain valid (the schema has no ON DELETE CASCADE on those foreign
keys).

If a scanner with a previously-disabled `usb_port` is re-detected, the
existing row SHALL be re-enabled (`enabled = true`) by the upsert path,
not duplicated.

#### Scenario: Stale rows are disabled in save-scanners-db

- **GIVEN** enabled `GraviScanner` rows exist for
  `usb_port` ∈ `{'1-1','1-2','1-3'}`
- **WHEN** `graviscan:save-scanners-db` is invoked with a payload
  covering only `{'1-1','1-2'}`
- **THEN** the rows for `1-1` and `1-2` SHALL be updated normally
- **AND** the row for `1-3` SHALL be updated to `enabled = false`
- **AND** the row for `1-3` SHALL still exist (NOT deleted)

#### Scenario: validate-config disables stale rows instead of deleting

- **GIVEN** enabled `GraviScanner` rows exist for
  `usb_port` ∈ `{'1-1','1-2','1-3'}`
- **AND** USB enumeration detects only `{'1-1','1-2'}`
- **WHEN** `graviscan:validate-config` is invoked
- **THEN** the row for `1-3` SHALL be updated to `enabled = false`
- **AND** the row SHALL NOT be deleted
- **AND** the handler's return value SHALL reflect the validation
  status using the disabled rows correctly

#### Scenario: Disabled rows preserve FK chain to GraviScan

- **GIVEN** a `GraviScan` row references a `GraviScanner.id` via
  `scanner_id`
- **AND** that `GraviScanner` row is subsequently disabled by
  `save-scanners-db` or `validate-config`
- **THEN** the `GraviScan` row SHALL remain in the DB unchanged
- **AND** queries that JOIN the two tables SHALL still succeed
  (the FK reference resolves)

#### Scenario: Re-detection re-enables a previously-disabled row

- **GIVEN** a `GraviScanner` row for `usb_port='1-3'` exists with
  `enabled = false`
- **WHEN** `graviscan:save-scanners-db` is invoked with a payload
  including `{usb_port: '1-3'}`
- **THEN** the existing row SHALL be updated (upserted) with
  `enabled = true`
- **AND** exactly ONE row SHALL exist for `usb_port='1-3'` after the
  operation (verified via `db.graviScanner.count({where: {usb_port:
  '1-3'}})`)
- **AND** no new row SHALL be created (no duplicate)

#### Scenario: Disabled rows are excluded from all UI-facing queries

- **GIVEN** the DB contains both enabled and disabled `GraviScanner`
  rows
- **WHEN** any UI-facing query that lists scanners runs (e.g.,
  `graviscan:get-scanner-status`, `graviscan:validate-config`)
- **THEN** the response SHALL include ONLY rows with `enabled = true`
- **AND** code paths that intentionally include disabled rows (e.g.,
  audit/maintenance queries, if any) SHALL be explicitly documented
  with a code comment

---

### Requirement: scan_worker Subprocess Spawn on Scanner Discovery

The `graviscan:save-scanners-db` IPC handler SHALL call `coordinator.addScanner(config)` after the DB upsert phase for every payload entry that:

1. Is `enabled = true` after the upsert, AND
2. Does not already have a ready worker
   (`!coordinator.hasWorker(scannerId)`).

This ensures that newly-created `GraviScanner` rows — and rows that
are re-enabled after being disabled — get a `scan_worker` subprocess
without requiring an app restart.

The handler SHALL NOT spawn workers for rows that ended up
`enabled = false` (stale rows that were just disabled).

#### Scenario: Newly-created scanner gets a worker spawned

- **GIVEN** a `ScanCoordinator` with no worker for scanner_id `X`
- **WHEN** `graviscan:save-scanners-db` is invoked with a payload
  containing a NEW entry whose row ends up with id=`X` and
  `enabled=true`
- **THEN** `coordinator.addScanner(...)` SHALL be called with config
  for `X`
- **AND** after settling, `coordinator.hasWorker('X')` SHALL return
  `true`

#### Scenario: Already-running scanner does not spawn duplicate worker

- **GIVEN** a `ScanCoordinator` already has a ready worker for
  scanner_id `Y`
- **WHEN** `graviscan:save-scanners-db` is invoked with a payload
  including `Y`
- **THEN** `coordinator.addScanner` SHALL NOT spawn a new subprocess
  for `Y` (the existing one is reused)

#### Scenario: Disabled rows are not spawned

- **GIVEN** the payload causes scanner_id `Z` to end up `enabled=false`
  (e.g., it was a stale row being disabled)
- **WHEN** `graviscan:save-scanners-db` completes its upsert phase
- **THEN** `coordinator.addScanner` SHALL NOT be called for `Z`

---

### Requirement: Per-Scanner Disable IPC

The system SHALL provide a new IPC handler
`graviscan:disable-scanner` that takes a `scanner_id` and:

1. Sets `enabled = false` on the matching `GraviScanner` row.
2. Calls `coordinator.stopScanner(scanner_id)` if a worker exists for
   that id.
3. Returns `{ ok: true }` on success or `{ ok: false, error: '...' }`
   on failure (e.g., scanner_id not found).

This IPC backs the per-row Remove button on the Configure Scanner
page (see ui-management-pages capability).

#### Scenario: disable-scanner disables row and stops worker

- **GIVEN** a `GraviScanner` row exists for scanner_id `A` with
  `enabled=true`
- **AND** a ready worker for `A` is in the coordinator subprocess map
- **WHEN** `graviscan:disable-scanner('A')` is invoked
- **THEN** the row SHALL be updated to `enabled = false`
- **AND** `coordinator.stopScanner('A')` SHALL be called
- **AND** after settling, `coordinator.hasWorker('A')` returns `false`
- **AND** the handler SHALL return `{ ok: true }`

#### Scenario: disable-scanner with unknown id returns error

- **GIVEN** no `GraviScanner` row exists for scanner_id `'unknown'`
- **WHEN** `graviscan:disable-scanner('unknown')` is invoked
- **THEN** the handler SHALL return
  `{ ok: false, error: <descriptive message> }`
- **AND** SHALL NOT throw

#### Scenario: disable-scanner is idempotent

- **GIVEN** a `GraviScanner` row for scanner_id `A` is already
  `enabled = false` and has no worker
- **WHEN** `graviscan:disable-scanner('A')` is invoked
- **THEN** the handler SHALL return `{ ok: true }`
- **AND** SHALL NOT throw or attempt to stop a non-existent worker
