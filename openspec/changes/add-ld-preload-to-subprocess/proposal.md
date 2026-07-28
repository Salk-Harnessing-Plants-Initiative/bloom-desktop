## Why

The epkowa SANE backend opens and claims USB interfaces on ALL connected Epson scanners during `sane_open()`, even when targeting just one. This prevents parallel scanning because two processes cannot claim the same USB interface. The `libusb-filter.so` library (PR #172) intercepts `libusb_open()` and restricts each process to its assigned scanner. It's compiled on the graviscan machine but not yet wired into the app's subprocess spawn.

## What Changes

- Set `LD_PRELOAD` and `SANE_USB_FILTER` environment variables in `scanner-subprocess.ts` `spawn()` call
- Parse bus:device from `saneName` (e.g., `epkowa:interpreter:001:007` → `001:007`) for `SANE_USB_FILTER`
- Linux-only, skip in mock mode
- Add `libusb-filter.so` to `forge.config.ts` `extraResource` for packaged builds
- Resolve `.so` path: dev mode from `src/main/native/`, packaged from `Resources/`

### Implementation constraints

- **No env var for the `.so` path.** Derive from `app.isPackaged` + known locations.
- **Linux-only guard.** `process.platform === 'linux'` — no fallback for other platforms.
- **Skip in mock mode.** No `LD_PRELOAD` when `this.mock === true`.
- **Hardcode bus:device extraction.** `saneName.split(':')` — last two segments, zero-padded.
- **Log the env vars on spawn** so hardware debugging shows what filter is active.
- **No changes to Python.** scan_worker.py doesn't need modification — `LD_PRELOAD` is handled by the OS loader.

## Impact

- Affected specs: `scanning`
- Affected code:
  - `src/main/scanner-subprocess.ts` — add `LD_PRELOAD` + `SANE_USB_FILTER` to spawn env (~15 lines)
  - `forge.config.ts` — add `libusb-filter.so` to extraResource (~1 line)
