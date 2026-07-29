## Why

When a scanner fails mid-session, the USB device disconnects and reconnects with a new device number (issue #182). The current "Reset & Re-detect" button runs `pkill` + lsusb but does not close SANE gracefully and leaves stale `usb_bus`/`usb_device` values in the database. The only reliable recovery is restarting the app.

## What Changes

- New IPC handler `graviscan:reset-usb` that performs a clean reset cycle:
  1. Gracefully shuts down coordinator (`coordinator.shutdown()` — sends `quit` to each subprocess, SANE closes cleanly)
  2. Clears `usb_bus` and `usb_device` on all enabled GraviScanner DB records (keeps `usb_port` for stable matching)
  3. Waits 5s for USB bus release (hardcoded — this is a hardware constant, not configurable)
  4. Calls `detectEpsonScanners()` for fresh lsusb scan
  5. Matches detected scanners to DB records by `usb_port`, updates `usb_bus`/`usb_device`
  6. Calls `coordinator.initialize()` with fresh ScannerConfigs
  7. Returns `{ success, scanners: [{id, status}] }`
- Replace "Reset & Re-detect" button label with "Reset USB" and call new handler
- Keep old `graviscan:reset-scanners` handler until hardware-tested

### Implementation constraints (from `/no-overengineering`, `/self-review`, `/code-standards`)

- **No speculative UI.** No multi-step status display. Button shows "Resetting..." spinner during operation, then result.
- **No env var for the 5s wait.** This is a USB hardware constant — hardcode as `USB_RELEASE_WAIT_MS = 5000`.
- **No coordinator changes.** `shutdown()` and `initialize()` already exist and work.
- **Error handling:** handler catches at the IPC boundary, returns `{ success: false, error }`. No nested try/catch layers.
- **Type safety:** return type defined as interface in `src/types/graviscan.ts`. `import type` used in handler.
- **Naming:** IPC channel `graviscan:reset-usb`. Handler logs with `[GraviScan:RESET-USB]` prefix.
- **No backwards compat shims.** Old button code replaced directly.

## Impact

- Affected specs: `scanning`
- Affected code:
  - `src/main/graviscan-handlers.ts` — new `graviscan:reset-usb` handler (~40 lines)
  - `src/renderer/ConfigureScanner.tsx` — replace button onClick + label (~5 lines changed)
  - `src/types/electron.d.ts` — add `resetUsb` method signature
  - `src/main/preload.ts` — expose `resetUsb` to renderer
  - `src/types/graviscan.ts` — add `ResetUsbResult` interface
