## 1. Implementation

- [x] 1.1 Add `_reset_usb_device()` method to `ScanWorker` class — parses bus:device from `self.device_name`, performs `USBDEVFS_RESET` ioctl via `fcntl`, skips on non-Linux
- [x] 1.2 Call `_reset_usb_device()` in `_reopen_device()` between `sane.exit()` and `time.sleep(3)`
- [ ] 1.3 Verify existing tests pass (`uv run pytest python/tests -v`)

## 2. Linux Laptop Verification

- [ ] 2.1 Pull the branch: `git pull origin feature/graviscan`
- [ ] 2.2 Run the app from terminal to capture logs: `npm run start:app:graviscan 2>&1 | tee scan-recovery.log`
- [ ] 2.3 Trigger a scan — during a multi-cycle session, watch for any scan failure + recovery
- [ ] 2.4 Confirm log shows `USB device reset: /dev/bus/usb/BBB/DDD` before `Full SANE reinit for device:`
- [ ] 2.5 Confirm the scanner recovers and continues scanning after the USB reset
- [ ] 2.6 If USB reset fails with `Permission denied`, run: `sudo chmod 666 /dev/bus/usb/BBB/DDD` (replace BBB/DDD with actual values from `lsusb`)
