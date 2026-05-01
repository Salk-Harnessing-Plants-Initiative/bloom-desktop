## 1. TDD — Failing tests first

- [x] 1.1 Add to `tests/unit/graviscan/scanner-handlers.test.ts`:
  - (a) `detectScanners` in mock mode with 1 enabled and 1 disabled DB row → returns 2 scanners (both rows surfaced)
  - (b) Each returned scanner SHALL carry `enabled` matching its DB row (`true` for the enabled row, `false` for the disabled row)
  - (c) `detectScanners` in real mode (lsusb) → matched scanners get `enabled` from their DB row; unmatched scanners (newly-discovered hardware not yet in DB) leave `enabled` unset
  - (d) `detectScanners` mock mode with empty DB still returns 2 placeholder scanners with `scanner_id: ''` and `enabled` unset (fresh-install case)

- [x] 1.2 Add to `tests/unit/hooks/useScannerConfig.test.ts`:
  - (e) When `detectScanners` returns a scanner with `enabled: false`, `buildAssignmentsFromDetection` produces an assignment with `scannerId: null` for that scanner — the checkbox renders unchecked
  - (f) When `detectScanners` returns a scanner with `enabled: true`, the assignment has `scannerId` set to the scanner's id (existing behavior preserved)
  - (g) When `detectScanners` returns a scanner with `enabled` unset (undefined), it is treated as `true` (newly-discovered scanners default to checked)
  - (h) `localStorage.uncheckedScannerKeys` and DB `enabled: false` are reconciled: a scanner is checked iff `(enabled !== false) AND key not in uncheckedScannerKeys`

- [x] 1.3 Run failing tests:
  ```bash
  npm run test:unit -- tests/unit/graviscan/scanner-handlers.test.ts tests/unit/hooks/useScannerConfig.test.ts --run
  ```
  Confirm new tests fail for behavior reasons, not type/compile reasons. **Confirmed:** 5 new tests failed for behavior reasons before implementation.

**Check gate (after 1.3):** New tests fail. Existing tests still pass. ✅

## 2. Implementation — green phase

- [x] 2.1 Add `enabled?: boolean` to `DetectedScanner` interface in `src/types/graviscan.ts`. Document that absent means "treat as true (newly-discovered scanner default)" and present means "this came from a DB row with that enabled state."

- [x] 2.2 In `src/main/graviscan/scanner-handlers.ts`:
  - Change `detectScanners`'s `findMany` query to remove `where: { enabled: true }` — return ALL DB rows. Justification: the renderer needs disabled rows so the user can re-enable them.
  - In `buildMockScanners`, populate `enabled: row.enabled` on each scanner derived from a DB row. For empty-DB placeholder branches, leave `enabled` unset.
  - In `matchDetectedToDb`, populate `detected.enabled = match.enabled` whenever a DB match is found (both the primary and fallback match paths). Leave it unset for unmatched detections.
  - Do NOT change `validateConfig` or `runStartupScannerValidation` — those continue to query `enabled: true` (their semantic is "scanners I expect to be operational right now").

- [x] 2.3 In `src/renderer/hooks/useScannerConfig.ts`, update `buildAssignmentsFromDetection`:
  - Compute `isDisabledInDb = s.enabled === false` (strict comparison so unset is NOT treated as disabled)
  - Treat the scanner as unchecked if `isUnchecked || isDisabledInDb`
  - Document the reconciliation rule in a comment

- [x] 2.4 Run the test suite:

  ```bash
  npm run test:unit -- tests/unit/graviscan/scanner-handlers.test.ts tests/unit/hooks/useScannerConfig.test.ts --run
  ```

  All previously-failing tests SHALL now pass. No existing tests SHALL regress. **Confirmed:** 71/71 pass.

- [x] 2.5 Run the full unit suite + tsc + lint + prettier to confirm no collateral damage:
  ```bash
  npm run test:unit
  npx tsc --noEmit
  npm run lint
  npx prettier --check "src/**/*.{ts,tsx}" "tests/**/*.{ts,tsx}"
  ```
  **Confirmed:** 970/979 unit tests pass (9 skipped), tsc/lint/prettier all clean.

**Check gate (after 2.5):** All green. ✅

## 3. Manual verification

- [x] 3.1 Restart dev server: `GRAVISCAN_MOCK=true npm run start`
- [x] 3.2 Confirm Scanner Configuration page shows BOTH Scanner 1 (enabled, checked) and Scanner 2 (disabled from previous test, unchecked). **Confirmed.**
- [x] 3.3 Click Scanner 2's checkbox to re-enable it. **Confirmed.**
- [x] 3.4 Click Save Configuration. **Confirmed — green banner appeared, both upserts succeeded.**
- [x] 3.5 Confirm green success banner appears with "2 scanners saved · 2-Grid · 1200 DPI". **Confirmed.**
- [x] 3.6 Verify in DB:
  ```bash
  sqlite3 ~/.bloom/dev.db "SELECT name, enabled FROM GraviScanner;"
  ```
  Both rows SHALL have `enabled=1`. **Confirmed:** `Mock Scanner 1|1-1|1` and `Mock Scanner 2|1-2|1`.
- [ ] 3.7 Repeat the round-trip: uncheck Scanner 2, save, reload renderer, confirm Scanner 2 still appears (unchecked) and can be re-enabled. (Implicit verification via 3.2 — Scanner 2 was disabled from a previous round, surfaced after this fix, re-enabled successfully. Standalone re-test deferred.)

## 4. Final verification

- [x] 4.1 `npm run test:unit` passes — 970 passed
- [x] 4.2 `npx tsc --noEmit` clean
- [x] 4.3 `npm run lint` clean
- [x] 4.4 `npx prettier --check` clean
- [x] 4.5 `openspec validate surface-disabled-scanners-on-detect --strict` passes
