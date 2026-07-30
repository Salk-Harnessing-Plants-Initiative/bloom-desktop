## ADDED Requirements

### Requirement: GraviScan System Name Environment Variable

The application SHALL load the `GRAVISCAN_SYSTEM_NAME` environment
variable from `~/.bloom/.env` via `src/main/config-store.ts`, following
the same optional-string pattern already established for
`BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` (`slack_webhook_url`).

- Absent or empty value ⇒ `graviscan_system_name = undefined`. Every
  consumer that reads `process.env.GRAVISCAN_SYSTEM_NAME` (GraviScan
  upload and Box-backup paths) SHALL treat this as "no system-name
  attribution available" and proceed without it, exactly as they do
  today.
- Present non-empty value ⇒ `graviscan_system_name` is set to that
  value verbatim, and `src/main/main.ts` hydrates
  `process.env.GRAVISCAN_SYSTEM_NAME` from it at startup so the
  following call sites receive the configured value:
  `src/main/box-backup.ts:354`,
  `src/main/graviscan/scanner-handlers.ts:450` and `:459`,
  `src/main/graviscan-upload.ts:313` and `:530`.

`saveEnvConfig()` SHALL use its existing read-merge-write semantics for
this field: a save operation that does not carry
`graviscan_system_name` (i.e. the incoming config object has it as
`undefined`) SHALL leave any previously-persisted value in
`~/.bloom/.env` unchanged, rather than erasing it. A save operation
that explicitly carries a new value SHALL overwrite the persisted
value. The field SHALL be omitted entirely from the written file when
its resolved value is `undefined`, mirroring `slack_webhook_url`'s
behavior (no `GRAVISCAN_SYSTEM_NAME=` line with an empty right-hand
side).

The variable SHALL be documented in `README.md` (alongside the existing
V600 wedge-followups environment variables) and in `.env.example`.

Operator-editable UI for this field (a `MachineConfiguration.tsx`
renderer field) is out of scope for this requirement — `main` has no
renderer implementation of the Machine Configuration page yet.

#### Scenario: Absent env var leaves system-name attribution unset

- **GIVEN** `~/.bloom/.env` does not set `GRAVISCAN_SYSTEM_NAME`
- **WHEN** the main process starts and `loadEnvConfig()` runs
- **THEN** the returned config SHALL have
  `graviscan_system_name = undefined`
- **AND** `main.ts` SHALL NOT set `process.env.GRAVISCAN_SYSTEM_NAME`
- **AND** it SHALL log that `GRAVISCAN_SYSTEM_NAME` is not configured

#### Scenario: Present env var enables system-name attribution

- **GIVEN** `~/.bloom/.env` contains `GRAVISCAN_SYSTEM_NAME=pbiob-gh-04`
- **WHEN** the main process starts
- **THEN** `loadEnvConfig()` SHALL return
  `graviscan_system_name = 'pbiob-gh-04'`
- **AND** `main.ts` SHALL set `process.env.GRAVISCAN_SYSTEM_NAME` to
  `'pbiob-gh-04'`
- **AND** every call site reading `process.env.GRAVISCAN_SYSTEM_NAME`
  (GraviScan upload, Box backup) SHALL observe that value

#### Scenario: Empty value is treated as absent

- **GIVEN** `~/.bloom/.env` contains `GRAVISCAN_SYSTEM_NAME=` (no value)
- **WHEN** `loadEnvConfig()` runs
- **THEN** it SHALL return `graviscan_system_name = undefined`

#### Scenario: Save preserves an unconfigured field it did not carry

- **GIVEN** `~/.bloom/.env` contains
  `GRAVISCAN_SYSTEM_NAME=graviscan-ms-7c56`
- **WHEN** the renderer's config-save round-trip calls `saveEnvConfig()`
  with a config object that does not include `graviscan_system_name`
  (`undefined`), after editing an unrelated field
- **THEN** the saved `~/.bloom/.env` SHALL still contain
  `GRAVISCAN_SYSTEM_NAME=graviscan-ms-7c56` unchanged

#### Scenario: Explicit new value overwrites the persisted value

- **GIVEN** `~/.bloom/.env` contains `GRAVISCAN_SYSTEM_NAME=old-name`
- **WHEN** `saveEnvConfig()` is called with
  `graviscan_system_name: 'new-name'`
- **THEN** the saved `~/.bloom/.env` SHALL contain
  `GRAVISCAN_SYSTEM_NAME=new-name`

#### Scenario: Documented in README and .env.example

- **GIVEN** the repository working tree
- **WHEN** the operator inspects `README.md` and `.env.example`
- **THEN** both files SHALL document `GRAVISCAN_SYSTEM_NAME` and note
  that it is configured per-machine via `~/.bloom/.env`
