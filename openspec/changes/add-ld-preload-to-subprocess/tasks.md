## 1. Subprocess Integration

- [x] 1.1 Add `LD_PRELOAD` and `SANE_USB_FILTER` to `spawn()` env in `scanner-subprocess.ts`
- [x] 1.2 Parse bus:device from `saneName` (e.g., `epkowa:interpreter:001:007` → `001:007`)
- [x] 1.3 Resolve `libusb-filter.so` path (dev: `src/main/native/`, packaged: `Resources/`)
- [x] 1.4 Guard: Linux-only (`process.platform === 'linux'`), skip in mock mode
- [x] 1.5 Log `LD_PRELOAD` and `SANE_USB_FILTER` values on spawn for debugging

## 2. Packaging

- [x] 2.1 Add `libusb-filter.so` to `forge.config.ts` `extraResource`

## 3. Tests

- [ ] 3.1 Unit test: env vars set correctly for Linux real mode
- [ ] 3.2 Unit test: env vars NOT set for mock mode
- [ ] 3.3 Unit test: bus:device parsing from saneName
