## 1. Types

- [x] 1.1 Add `ResetUsbResult` interface to `src/types/graviscan.ts`
- [x] 1.2 Add `resetUsb(): Promise<ResetUsbResult>` to `ElectronAPI.graviscan` in `electron.d.ts`
- [x] 1.3 Expose `resetUsb` in `preload.ts` context bridge

## 2. IPC Handler

- [x] 2.1 Add `graviscan:reset-usb` handler in `graviscan-handlers.ts`

## 3. UI

- [x] 3.1 Replace "Reset & Re-detect" button with "Reset USB" in `ConfigureScanner.tsx`

## 4. Tests

- [ ] 4.1 Unit test: handler shuts down coordinator, clears DB fields, re-detects, re-initializes
- [ ] 4.2 Unit test: handler returns disconnected status for unplugged scanner
- [ ] 4.3 Unit test: handler works when coordinator is null (no scanners configured yet)
- [ ] 4.4 Unit test: handler works when lsusb returns 0 scanners
