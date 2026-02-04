## 1. Implementation

- [x] 1.1 Create `tests/e2e/helpers/electron-cleanup.ts` with `closeElectronApp()` helper
- [x] 1.2 Add process termination verification logic (poll for process exit)
- [x] 1.3 Add fallback force-kill for stuck processes
- [x] 1.4 Update `app-launch.e2e.ts` to use new cleanup helper
- [x] 1.5 Update `accession-excel-upload.e2e.ts` to use new cleanup helper
- [x] 1.6 Update `scientists-management.e2e.ts` to use new cleanup helper
- [x] 1.7 Update `phenotypers-management.e2e.ts` to use new cleanup helper
- [x] 1.8 Update `accessions-management.e2e.ts` to use new cleanup helper
- [x] 1.9 Update `experiments-management.e2e.ts` to use new cleanup helper
- [x] 1.10 Update `experiment-accession-indicator.e2e.ts` to use new cleanup helper
- [x] 1.11 Update `plant-barcode-validation.e2e.ts` to use new cleanup helper
- [x] 1.12 Update `renderer-database-ipc.e2e.ts` to use new cleanup helper
- [x] 1.13 Update `machine-config-fetch-scanners.e2e.ts` to use new cleanup helper
- [x] 1.14 Update `database-auto-init.e2e.ts` to use new cleanup helper

## 2. Testing

- [ ] 2.1 Run E2E tests locally to verify cleanup works
- [ ] 2.2 Push changes and verify CI E2E tests pass
- [ ] 2.3 Verify no Electron process leaks after test suite completes

## 3. Documentation

- [x] 3.1 Add comments explaining race condition fix
- [ ] 3.2 Update memory file with lessons learned
