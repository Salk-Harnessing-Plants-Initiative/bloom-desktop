## Why

Production (`origin/fix/v600-wedge-followups-metadata_propogation_followup`)
has a `graviscan_system_name` field fully wired through
`src/main/config-store.ts` (type, default, env-file parsing, save-back) and
hydrated into `process.env.GRAVISCAN_SYSTEM_NAME` at startup in
`src/main/main.ts`. `main`'s `config-store.ts` has no such field at all —
yet `main` already has 5 call sites that read
`process.env.GRAVISCAN_SYSTEM_NAME` directly: `src/main/box-backup.ts:354`,
`src/main/graviscan/scanner-handlers.ts:450` and `:459`, and
`src/main/graviscan-upload.ts:313` and `:530`. Since nothing on `main` ever
populates that env var, it is always `undefined`, and every uploaded
session/image and every Box-backup path silently loses system-name
attribution. This is a real operational problem for multi-rig fleets where
distinguishing which physical rig produced a given upload matters.

This is the same shape of gap as the prior `slack_webhook_url` /
`libusb_endpoint_recovery` port (`add-v600-wedge-followups`, archived
2026-07-29): a config field that exists in production but was never
ported to `main`, with `main`'s consumers already written against the
(currently unpopulated) env var.

## What Changes

- Add `graviscan_system_name` to `configuration` capability's
  `MachineConfig` handling in `src/main/config-store.ts`, following the
  exact 3-place code pattern already established by `slack_webhook_url`
  (the more directly analogous precedent, since both are plain optional
  strings, unlike the boolean `libusb_endpoint_recovery`):
  1. `graviscan_system_name?: string` field on the `MachineConfig` type.
  2. A `case 'GRAVISCAN_SYSTEM_NAME':` branch in `parseEnvFile()`'s
     switch, treating an empty value as absent (mirrors
     `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL`'s handling).
  3. A guarded write-back block in `saveEnvConfig()`'s read-merge-write
     logic — the line is written to `~/.bloom/.env` only when
     `graviscan_system_name !== undefined`, so a save that never carried
     the field (e.g. today's `config:get` whitelist) does not erase an
     existing value, and an unconfigured field does not pollute the file.
- Hydrate `process.env.GRAVISCAN_SYSTEM_NAME` from the already-loaded
  `config` object at startup in `src/main/main.ts` (same `try` block,
  same `loadEnvConfig(ENV_PATH)` call already used for the
  `slack_webhook_url`/`libusb_endpoint_recovery` hydration — no new
  `loadEnvConfig()` call needed), with a console.log on both the
  configured and not-configured paths.
- Document `GRAVISCAN_SYSTEM_NAME` in `.env.example` and `README.md`
  alongside the existing V600 wedge-followups env-var documentation, for
  discoverability (matching the precedent set for the two prior fields).
- Does NOT modify the 5 existing call sites — they already correctly
  read `process.env.GRAVISCAN_SYSTEM_NAME`; fixing `config-store.ts` +
  `main.ts` alone makes the variable actually populated for all 5.

## Impact

- **Affected specs:** `configuration`
- **Affected code:**
  - `src/main/config-store.ts` (type, `parseEnvFile()`, `saveEnvConfig()`)
  - `src/main/main.ts` (startup hydration, ~line 1153-1177)
  - `.env.example`, `README.md` (documentation only)
- **Tests:** `tests/unit/config-store.test.ts` (new describe blocks
  mirroring the existing `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` /
  `V600 wedge follow-ups: saveEnvConfig round-trip` sections); a new
  small unit test mirroring `main.ts`'s hydration `if`/`else` logic
  (following the same "logic that will be implemented in main.ts"
  pattern already used by `tests/unit/scanner-identity.test.ts`, since
  `main.ts` itself has Electron-import side effects and is not directly
  unit-testable — no existing test imports `main.ts` for any of its
  startup hydration logic today, including the precedent
  `slack_webhook_url`/`libusb_endpoint_recovery` blocks).
- **Database:** none.
- **Renderer:** none — `main` has no renderer implementation of the
  Machine Configuration page yet (`MachineConfiguration.tsx` does not
  exist in `src/renderer/`). Operator-editable UI for this field is
  explicitly **out of scope** here and is a follow-up once the renderer
  itself is ported (tracked in `docs/superpowers/plans/2026-07-29-graviscan-production-parity-gaps.md`).

## Out of scope

- Renderer wiring (`MachineConfiguration.tsx`) — no renderer exists on
  `main` yet; do not invent one to satisfy this proposal.
- Changing behavior at any of the 5 existing call sites that read
  `process.env.GRAVISCAN_SYSTEM_NAME` — they are already correct.
- Any change to how Box backup or GraviScan upload use the system name
  once populated (that logic is untouched and out of scope; this
  proposal is purely about making the env var non-`undefined`).
