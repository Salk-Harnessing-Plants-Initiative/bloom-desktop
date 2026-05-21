## ADDED Requirements

### Requirement: Slack Webhook URL Environment Variable

The application SHALL load the `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL`
environment variable from `~/.bloom/.env` via
`src/main/config-store.ts`. The value SHALL be exposed to the main
process through the existing `loadEnvConfig()` return shape (or a
sibling getter) so that `src/main/slack-notifier.ts` can read it at
startup.

- Absent or empty value ⇒ the Slack notification feature is disabled
  (no fetch, no log spam — see scanning capability).
- Present value ⇒ used verbatim as the POST target for wedge
  notifications.

The webhook URL is a secret. It SHALL NEVER appear in any committed
file. The repository SHALL ship a `.env.example` at the repo root
documenting the variable with a placeholder value and an inline
comment warning operators not to commit a real value.

#### Scenario: Absent env var disables Slack feature

- **GIVEN** `~/.bloom/.env` does not set
  `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL`
- **WHEN** the main process starts and `loadEnvConfig()` runs
- **THEN** the returned config SHALL have
  `slackWebhookUrl = undefined`
- **AND** the `SlackNotifier` SHALL initialize in disabled mode

#### Scenario: Present env var enables Slack feature

- **GIVEN** `~/.bloom/.env` contains
  `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T/B/X`
- **WHEN** the main process starts
- **THEN** `loadEnvConfig()` SHALL return
  `slackWebhookUrl = 'https://hooks.slack.com/services/T/B/X'`
- **AND** the `SlackNotifier` SHALL accept wedge events and POST to
  that URL

#### Scenario: .env.example is shipped without a real value

- **GIVEN** the repository working tree
- **WHEN** the operator inspects `.env.example`
- **THEN** the file SHALL contain a `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL`
  line with a placeholder (e.g.,
  `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/REPLACE_ME`)
- **AND** the file SHALL contain a comment warning operators not to
  commit the real value

#### Scenario: Real webhook URL is not in any committed file

- **GIVEN** the full git history of the branch
- **WHEN** searched for the Slack webhook URL pattern
- **THEN** no committed file SHALL contain a real value (only the
  `.env.example` placeholder is permitted)

---

### Requirement: libusb Endpoint Recovery Toggle Environment Variable

The application SHALL load the `LIBUSB_ENDPOINT_RECOVERY` environment
variable from `~/.bloom/.env` via `src/main/config-store.ts`.

- Unset or value other than `"false"` (case-insensitive) ⇒
  `libusbEndpointRecovery = true` (the default — wrapper is active).
- Value `"false"` (case-insensitive) ⇒ `libusbEndpointRecovery = false`
  (wrapper is a pass-through).

`src/main/scanner-subprocess.ts` SHALL pass the resolved
`LIBUSB_ENDPOINT_RECOVERY` value to the scanner subprocess
environment alongside the existing `LD_PRELOAD` and `SANE_USB_FILTER`
variables (Linux non-mock only).

The variable SHALL be documented in `README.md` (a new "Environment
variables" subsection) and in `.env.example`.

#### Scenario: Unset env var defaults to enabled

- **GIVEN** `~/.bloom/.env` does not set `LIBUSB_ENDPOINT_RECOVERY`
- **WHEN** the main process starts
- **THEN** `loadEnvConfig()` SHALL return
  `libusbEndpointRecovery = true`

#### Scenario: Explicit "false" disables the wrapper

- **GIVEN** `~/.bloom/.env` contains
  `LIBUSB_ENDPOINT_RECOVERY=false`
- **WHEN** the main process starts
- **THEN** `loadEnvConfig()` SHALL return
  `libusbEndpointRecovery = false`
- **AND** the subprocess env passed to `ScannerSubprocess.spawn()`
  SHALL include `LIBUSB_ENDPOINT_RECOVERY=false` (which the C-shim
  reads at init)

#### Scenario: Case-insensitive truthy values

- **GIVEN** `~/.bloom/.env` contains `LIBUSB_ENDPOINT_RECOVERY=True`
  (capital T)
- **WHEN** the main process starts
- **THEN** `loadEnvConfig()` SHALL return
  `libusbEndpointRecovery = true`

#### Scenario: Documented in README and .env.example

- **GIVEN** the repository working tree
- **WHEN** the operator inspects `README.md` and `.env.example`
- **THEN** both files SHALL document `LIBUSB_ENDPOINT_RECOVERY` with
  its default and the meaning of `false`
- **AND** `.env.example` SHALL contain a commented example line such
  as `# LIBUSB_ENDPOINT_RECOVERY=true`
