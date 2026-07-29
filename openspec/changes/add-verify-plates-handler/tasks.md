## 1. Schema

- [ ] 1.1 Add `verification_status String @default("pending")` to
      `GraviScanPlateAssignment` in `prisma/schema.prisma`
- [ ] 1.2 Generate migration via `prisma migrate dev` (do not hand-write SQL)
- [ ] 1.3 Regenerate Prisma Client

## 2. Dependency

- [ ] 2.1 Add `@undecaf/zbar-wasm@^0.11.0` to `package.json` dependencies and
      install (commit updated lockfile)

## 3. QR Reader Module

- [ ] 3.1 Port `src/main/qr-reader.ts` verbatim from production
      (`readQrCodes()`, sequential decode queue)
- [ ] 3.2 Port `tests/unit/qr-reader.test.ts` fixture-based tests for the real
      exported `readQrCodes()` function

## 4. Verify-Plates Handler Module

- [ ] 4.1 Create `src/main/graviscan/verify-plates.ts` exporting
      `verifyPlates(db, plates, experimentId?, onProgress?)`
- [ ] 4.2 Port QR-read step, duplicate-QR detection, per-plate DB lookup +
      classification (`verified`/`incorrect`/`unreadable`/`needs_review`/`duplicate_qr`)
- [ ] 4.3 Port swap detection + auto-correction (`GraviScanPlateAssignment`
      and `GraviScan` updates), each DB write wrapped in its own try/catch
- [ ] 4.4 Port final `verification_status` persistence per result
- [ ] 4.5 Wire progress callback (`verify-started`/`verify-result`/`verify-complete`
      equivalents) via callback injection, matching `image-handlers.ts`'s
      pattern of keeping the module decoupled from Electron IPC

## 5. IPC Registration

- [ ] 5.1 Register `graviscan:verify-plates` in `register-handlers.ts`,
      forwarding progress callback events to
      `graviscan:verify-started`/`graviscan:verify-result`/`graviscan:verify-complete`
      via `getMainWindow()?.webContents.send(...)`

## 6. Tests

- [ ] 6.1 Handler-level tests for `verifyPlates()`: verified, incorrect,
      unreadable, needs_review (inconsistent QR mappings), duplicate_qr
- [ ] 6.2 Handler-level test: swap detection + DB auto-correction
      (`GraviScanPlateAssignment.plate_barcode`, `GraviScan.plate_barcode`)
- [ ] 6.3 Handler-level test: per-record DB write failure doesn't abort the
      rest of the batch
- [ ] 6.4 Handler-level test: `experimentId` scoping narrows the
      `GraviPlateSectionMapping` lookup
- [ ] 6.5 Run full test suite + lint + typecheck

## 7. Spec

- [ ] 7.1 Add `scanning` spec delta describing the verify-plates capability
- [ ] 7.2 `openspec validate add-verify-plates-handler --strict`
