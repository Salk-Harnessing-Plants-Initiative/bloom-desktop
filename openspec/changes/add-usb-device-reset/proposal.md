## Why

When a scan fails mid-transfer, the current recovery in `_reopen_device()` does a SANE-level restart (`sane.exit()` → 3s sleep → `sane.init()` → `sane.open()`), but does not flush stale USB bulk transfers at the kernel level. The scanner hardware may still be pushing image data over the USB pipe, causing the reopened SANE handle to inherit a corrupted connection — leading to repeated failures and eventual app crashes during long-running scan sessions.

## What Changes

- Add a `_reset_usb_device()` method to `ScanWorker` that performs a Linux `USBDEVFS_RESET` ioctl to soft-reset the USB endpoint between `sane.exit()` and `sane.init()`
- This flushes stuck USB transfers while preserving the bus:device address (so the SANE device name `epkowa:interpreter:BBB:DDD` remains valid)
- The reset is non-fatal: if it fails (permissions, non-Linux), recovery continues with the existing SANE-only approach
- Single-file fix in `python/graviscan/scan_worker.py`

## Impact

- Affected specs: scan-pipeline
- Affected code: `python/graviscan/scan_worker.py` (`_reopen_device()` at lines 410-467)
- Risk: Low — the USB reset is wrapped in try/except and skipped on non-Linux platforms; existing recovery path is unchanged as fallback
