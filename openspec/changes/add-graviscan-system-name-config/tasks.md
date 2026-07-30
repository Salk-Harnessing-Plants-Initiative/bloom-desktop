# Tasks: Add graviscan_system_name config field

TDD: write the test FIRST, watch it fail (or fail to compile), then write
the minimum code to make it pass.

## 1. config-store.ts — type, parse, save-back

- [x] 1.1 Write failing tests in `tests/unit/config-store.test.ts` (new
      `describe('GRAVISCAN_SYSTEM_NAME', ...)` block mirroring the
      existing `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` block): - `loadEnvConfig()` returns `graviscan_system_name: undefined` when
      `.env` does not exist. - returns `undefined` when `.env` exists but the variable is not
      set. - returns the configured value when `GRAVISCAN_SYSTEM_NAME=...` is
      present. - returns `undefined` when the variable is present but empty
      (`GRAVISCAN_SYSTEM_NAME=` with no value).
- [x] 1.2 Add `graviscan_system_name?: string` to the `MachineConfig`
      type in `src/main/config-store.ts`, with a doc comment describing
      its purpose and the 5 consumer call sites.
- [x] 1.3 Add a `case 'GRAVISCAN_SYSTEM_NAME':` branch to `parseEnvFile()`
      treating an empty value as absent (same pattern as
      `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL`).
- [x] 1.4 Confirm 1.1's tests pass.

## 2. saveEnvConfig round-trip

- [x] 2.1 Write failing tests in `tests/unit/config-store.test.ts` (new
      cases alongside the existing
      `describe('V600 wedge follow-ups: saveEnvConfig round-trip', ...)`
      block, or a sibling describe block): - persists `graviscan_system_name` across load -> save -> load. - load->save does NOT add `GRAVISCAN_SYSTEM_NAME` to the file when
      it was absent from the source `.env` (undefined ⇒ no line
      written). - omits the var from the saved file when explicitly `undefined` on
      the incoming config object. - a save that omits `graviscan_system_name` entirely (simulating
      `config:get`'s current whitelist not carrying the field) does
      NOT erase a previously-persisted value — read-merge-write
      preserves it (mirrors the existing
      `final-review fix #2` describe block's assertions for
      `slack_webhook_url`/`libusb_endpoint_recovery`). - an explicitly-provided new value still overwrites the on-disk
      value.
- [x] 2.2 Add a guarded write-back block to `saveEnvConfig()`: write
      `GRAVISCAN_SYSTEM_NAME=${merged.graviscan_system_name}` only when
      `merged.graviscan_system_name !== undefined`.
- [x] 2.3 Confirm 2.1's tests pass.

## 3. main.ts startup hydration

- [x] 3.1 Write a failing test mirroring `main.ts`'s exact hydration
      logic (following the same "logic that will be implemented in
      main.ts" approach `tests/unit/scanner-identity.test.ts` already
      uses for `scanner_name` — `main.ts` itself is not directly
      unit-testable due to Electron-import side effects, and no existing
      test imports it for any of its startup hydration, including the
      precedent `slack_webhook_url`/`libusb_endpoint_recovery` blocks).
      Add the test to `tests/unit/scanner-identity.test.ts` or a new
      small file, asserting: - given `config.graviscan_system_name` is a non-empty string, the
      hydration logic sets `process.env.GRAVISCAN_SYSTEM_NAME` to that
      value. - given `config.graviscan_system_name` is `undefined`/absent, the
      hydration logic does NOT set `process.env.GRAVISCAN_SYSTEM_NAME`.
- [x] 3.2 Add a third `if (config.graviscan_system_name) { ... } else { ... }`
      block to `src/main/main.ts`'s existing startup `try` block (the one
      that already calls `loadEnvConfig(ENV_PATH)` and hydrates
      `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL`/`LIBUSB_ENDPOINT_RECOVERY`),
      reusing the same `config` variable — no new `loadEnvConfig()` call.
      Each branch logs a console.log line confirming what happened.
- [x] 3.3 Confirm 3.1's test passes.

## 4. Documentation

- [x] 4.1 Add `GRAVISCAN_SYSTEM_NAME` to `.env.example`'s "GRAVISCAN V600
      WEDGE FOLLOW-UPS" section (or a new adjacent section), documenting
      that it is configured per-machine via `~/.bloom/.env`, not the
      repo-root `.env`.
- [x] 4.2 Add `GRAVISCAN_SYSTEM_NAME` to `README.md`'s "Environment
      Variables" section alongside the existing two entries.

## 5. Verification

- [x] 5.1 `npx vitest run tests/unit/config-store.test.ts` and any new
      test file(s) pass; only the pre-existing unrelated Windows
      path-separator failure in `getDefaultConfig` remains (if run on
      Windows).
- [x] 5.2 `npx tsc --noEmit` passes.
- [x] 5.3 `npx prettier --check` passes on all touched files.
- [x] 5.4 `openspec validate add-graviscan-system-name-config --strict`
      passes.
- [x] 5.5 `npx eslint --resolve-plugins-relative-to . <touched files>`
      is clean (workaround for this worktree's known
      `eslint-plugin-import` duplicate-resolution conflict with
      `npm run lint`, if hit).
