"""
Scan Worker — long-lived subprocess for a single scanner.

Each physical scanner gets its own worker process with an independent SANE instance.
The worker opens the device once, then enters a command loop reading stdin for
scan/cancel/quit JSON commands. This avoids SANE's process-wide global state issues.

Usage:
    python -m graviscan.scan_worker --device epkowa:interpreter:001:007 --scanner-id <uuid>
    python -m graviscan.scan_worker --mock --scanner-id <uuid>

Protocol:
    Commands (stdin, line-delimited JSON):
        {"action":"scan","plates":[
            {
                "plate_index":"00","grid_mode":"2grid","resolution":300,
                "output_dir":"/tmp/expA_wave1_20260301T120000",
                "exp_name":"expA","st_timestamp":"20260301T120000",
                "wave_number":1,"scanner_tag":"Sc1","system_prefix":"",
                "cycle":1
            }, ...
        ]}
        {"action":"cancel"}
        {"action":"quit"}

    The worker composes the final filename at save time including `_et_`,
    so `et` reflects the actual save moment.

    Events (stdout, line-prefixed):
        EVENT:{"type":"ready","scanner_id":"<id>"}
        EVENT:{"type":"scan-started","scanner_id":"<id>","plate_index":"00","job_id":"<uuid>"}
        EVENT:{"type":"scan-complete","scanner_id":"<id>","plate_index":"00","job_id":"<uuid>","path":"...","duration_ms":8500}
        EVENT:{"type":"scan-error","scanner_id":"<id>","plate_index":"00","job_id":"<uuid>","error":"..."}
        EVENT:{"type":"scan-cancelled","scanner_id":"<id>","plate_index":"00","job_id":"<uuid>"}
        EVENT:{"type":"cycle-done","scanner_id":"<id>","cycle":1}
"""

import argparse
import json
import os
import sys
import time
import uuid
import threading
from datetime import datetime, timezone

from PIL.TiffImagePlugin import ImageFileDirectory_v2, IFDRational

from .scan_regions import get_scan_region

# Application version embedded in TIFF metadata
_BLOOM_VERSION = "0.1.0"


def _build_tiff_metadata(
    scanner_id: str,
    plate: dict,
    region,
) -> ImageFileDirectory_v2:
    """Build TIFF metadata tags for a scan image.

    Embeds scan provenance into standard TIFF tags so files are self-describing.
    Structured metadata (incl. experiment + phenotyper attribution) goes into
    ImageDescription as JSON so the .tif is portable to Box, downstream
    pipelines, or scientists' laptops without the local DB.
    """
    resolution = plate["resolution"]
    ifd = ImageFileDirectory_v2()
    ifd[270] = json.dumps(
        {  # ImageDescription
            "scanner_id": scanner_id,
            "grid_mode": plate["grid_mode"],
            "plate_index": plate["plate_index"],
            "resolution_dpi": resolution,
            "scan_region_mm": {
                "top": region.top,
                "left": region.left,
                "width": region.width,
                "height": region.height,
            },
            "exp_name": plate["exp_name"],
            "wave_number": plate["wave_number"],
            "st_timestamp": plate["st_timestamp"],
            "phenotyper_name": plate.get("phenotyper_name") or "",
            "capture_timestamp": datetime.now(timezone.utc).isoformat(),
            "bloom_version": _BLOOM_VERSION,
        }
    )
    ifd[305] = "Bloom Desktop / GraviScan"  # Software
    ifd[282] = IFDRational(resolution, 1)  # XResolution
    ifd[283] = IFDRational(resolution, 1)  # YResolution
    ifd[296] = 2  # ResolutionUnit = inches
    ifd[306] = datetime.now().strftime("%Y:%m:%d %H:%M:%S")  # DateTime
    return ifd


def emit_event(event: dict) -> None:
    """Emit an EVENT: message to stdout."""
    print(f"EVENT:{json.dumps(event)}", flush=True)


def compose_output_path(plate: dict, et: str) -> str:
    """Build the final scan output path from plate components.

    The coordinator forwards components — never a pre-baked path — and the
    worker stamps `et` (end timestamp) at save time. Returns:

        {output_dir}/{exp_name}_wave{wave_number}_st_{st_timestamp}_et_{et}
            _cy{cycle}_{system_prefix}{scanner_tag}_{plate_index}.tif
    """
    filename = (
        f"{plate['exp_name']}_wave{plate['wave_number']}"
        f"_st_{plate['st_timestamp']}_et_{et}"
        f"_cy{plate['cycle']}"
        f"_{plate['system_prefix']}{plate['scanner_tag']}"
        f"_{plate['plate_index']}.tif"
    )
    return os.path.join(plate["output_dir"], filename)


def log(scanner_id: str, msg: str) -> None:
    """Log a debug message to stderr (not parsed as events)."""
    print(f"[{scanner_id}] {msg}", file=sys.stderr, flush=True)


class ScanWorker:
    """Long-lived scan worker for a single scanner."""

    def __init__(self, scanner_id: str, device_name: str, mock: bool = False):
        self.scanner_id = scanner_id
        self.device_name = device_name
        self.mock = mock
        self._device = None
        self._sane = None
        self._device_is_open = False
        self._cancel_requested = False
        self._cancel_lock = threading.Lock()
        self._cycle = 0
        # Raw RGB bytes received during the most recent scan attempt.
        # Reset to 0 at the start of each plate; set by _sane_scan or
        # _mock_scan on successful image acquisition. Exposed via the
        # scan-error event for wedge detection (#236).
        self._last_scan_bytes_received = 0

    def initialize(self) -> bool:
        """Initialize SANE and open the device. Returns True on success."""
        if self.mock:
            log(self.scanner_id, "Mock mode — skipping SANE init")
            emit_event({"type": "ready", "scanner_id": self.scanner_id})
            return True

        try:
            import sane

            self._sane = sane

            log(self.scanner_id, "Initializing SANE...")
            sane_version = sane.init()
            log(self.scanner_id, f"SANE initialized (version {sane_version})")

            log(self.scanner_id, f"Opening device: {self.device_name}")
            open_start = time.time()
            INIT_RETRIES = 3
            for init_attempt in range(INIT_RETRIES):
                try:
                    self._device = sane.open(self.device_name)
                    break
                except Exception as e:
                    try:
                        sane.exit()
                    except Exception:
                        pass
                    delay = 3 * (init_attempt + 1)
                    log(
                        self.scanner_id,
                        f"sane.open() failed ({init_attempt + 1}/{INIT_RETRIES}): {e} — waiting {delay}s...",
                    )
                    time.sleep(delay)
                    sane.init()
            else:
                raise RuntimeError(
                    f"Failed to open device after {INIT_RETRIES} attempts"
                )
            self._device_is_open = True
            log(self.scanner_id, f"Device opened in {time.time() - open_start:.1f}s")

            assert self._device is not None

            # Critical: initialize geometry by reading/writing boundary coords
            self._device.tl_x = 0
            self._device.tl_y = 0
            max_br_x = self._device.br_x
            max_br_y = self._device.br_y
            self._device.br_x = max_br_x
            self._device.br_y = max_br_y
            log(self.scanner_id, f"Geometry initialized: {max_br_x}x{max_br_y}mm")

            # Reset device to clean IDLE state after geometry init
            self._device.cancel()

            # Log available resolution options for debugging
            try:
                opts = self._device.get_options()
                for opt in opts:
                    if len(opt) > 1 and opt[1] == "resolution":
                        log(self.scanner_id, f"Resolution option: {opt}")
                        break
            except Exception as e:
                log(self.scanner_id, f"Could not read resolution options: {e}")

            # Verify the device accepts parameters by doing a test set
            # Use x_resolution/y_resolution (epkowa-specific) like scanimage does
            try:
                self._device.x_resolution = 200
                self._device.y_resolution = 200
                self._device.cancel()
                log(self.scanner_id, "Device parameter test passed")
            except Exception as e:
                log(self.scanner_id, f"WARNING: Device parameter test failed: {e}")

            emit_event({"type": "ready", "scanner_id": self.scanner_id})
            return True

        except Exception as e:
            emit_event(
                {
                    "type": "error",
                    "scanner_id": self.scanner_id,
                    "error": f"Failed to initialize: {e}",
                }
            )
            return False

    def run(self) -> None:
        """Enter the command loop. Reads stdin for JSON commands."""
        log(self.scanner_id, "Waiting for commands on stdin...")

        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            try:
                cmd = json.loads(line)
            except json.JSONDecodeError as e:
                log(self.scanner_id, f"Invalid JSON: {e}")
                continue

            action = cmd.get("action")

            if action == "scan":
                self._handle_scan(cmd)
            elif action == "cancel":
                self._handle_cancel()
            elif action == "quit":
                break
            else:
                log(self.scanner_id, f"Unknown action: {action}")

        self._shutdown()

    def _handle_scan(self, cmd: dict) -> None:
        """Handle a scan command — scan each plate at its exact grid ROI."""
        plates = cmd.get("plates", [])
        if not plates:
            log(self.scanner_id, "Scan command with no plates, ignoring")
            return

        with self._cancel_lock:
            self._cancel_requested = False

        self._cycle += 1

        for plate in plates:
            with self._cancel_lock:
                if self._cancel_requested:
                    job_id = str(uuid.uuid4())
                    emit_event(
                        {
                            "type": "scan-cancelled",
                            "scanner_id": self.scanner_id,
                            "plate_index": plate.get("plate_index", "?"),
                            "job_id": job_id,
                        }
                    )
                    break
            self._scan_plate(plate)

        emit_event(
            {
                "type": "cycle-done",
                "scanner_id": self.scanner_id,
                "cycle": self._cycle,
            }
        )

    def _handle_cancel(self) -> None:
        """Handle a cancel command — set flag to stop after current plate."""
        with self._cancel_lock:
            self._cancel_requested = True
        log(self.scanner_id, "Cancel requested — will stop after current plate")

    def _scan_plate(self, plate: dict) -> None:
        """Scan a single plate.

        Emits scan-started, then either scan-complete (with duration_ms) or
        scan-error (with duration_ms, bytes_received, wall_seconds).

        Timing uses time.monotonic() so it is immune to wall-clock
        adjustments. The bytes_received field reflects raw RGB bytes of
        any image data received before failure (0 for the common
        sane.start-failed case; image_width * image_height * 3 if snap()
        returned). See investigation summary Section 1.2 and #236 for
        the wedge-detection use case that motivates these fields.
        """
        plate_index = plate.get("plate_index", "00")
        job_id = str(uuid.uuid4())

        emit_event(
            {
                "type": "scan-started",
                "scanner_id": self.scanner_id,
                "plate_index": plate_index,
                "job_id": job_id,
            }
        )

        start_time = time.monotonic()
        # Reset bytes accumulator; inner scan methods set it on success.
        self._last_scan_bytes_received = 0

        try:
            if self.mock:
                final_path = self._mock_scan(plate)
            else:
                final_path = self._sane_scan(plate)

            duration_ms = int((time.monotonic() - start_time) * 1000)

            emit_event(
                {
                    "type": "scan-complete",
                    "scanner_id": self.scanner_id,
                    "plate_index": plate_index,
                    "job_id": job_id,
                    "path": final_path,
                    "duration_ms": duration_ms,
                }
            )

        except Exception as e:
            elapsed_s = time.monotonic() - start_time
            duration_ms = int(elapsed_s * 1000)
            log(self.scanner_id, f"Scan error (plate {plate_index}): {e}")

            emit_event(
                {
                    "type": "scan-error",
                    "scanner_id": self.scanner_id,
                    "plate_index": plate_index,
                    "job_id": job_id,
                    "error": str(e),
                    "duration_ms": duration_ms,
                    "bytes_received": self._last_scan_bytes_received,
                    "wall_seconds": elapsed_s,
                }
            )

    def _sane_scan(self, plate: dict) -> str:
        """Perform a scan using python-sane directly.

        Returns the final path the file was saved to. The filename — including
        `_et_` end timestamp — is composed at save time from the plate
        components.

        Uses x_resolution/y_resolution (epkowa per-axis options) instead of the
        generic resolution option which only supports [400,800,1600,3200].
        Critical: resolution and mode must be set BEFORE geometry for epkowa.

        The device stays open between scans. On failure, the device is closed
        and reopened on the next attempt.

        Retries up to 5 times with exponential backoff on failure.
        """
        MAX_RETRIES = 5
        plate_index = plate["plate_index"]
        grid_mode = plate["grid_mode"]
        resolution = plate["resolution"]
        region = get_scan_region(grid_mode, plate_index)

        log(
            self.scanner_id,
            f"Scanning plate {plate_index} ({grid_mode}) at {resolution}dpi "
            f"region=({region.left},{region.top})-({region.left+region.width},{region.top+region.height})",
        )

        # Ensure output directory exists upfront so retries don't race
        os.makedirs(plate["output_dir"], exist_ok=True)

        last_error = None

        for attempt in range(MAX_RETRIES):
            if attempt > 0:
                backoff = min(2 * (attempt + 1), 15)
                log(
                    self.scanner_id,
                    f"Retry backoff: waiting {backoff}s before attempt {attempt + 1}/{MAX_RETRIES}...",
                )
                time.sleep(backoff)

            try:
                # Reopen device if it was closed (e.g. after a previous failure)
                if not self._device_is_open:
                    self._reopen_device()

                assert self._device is not None

                # Set resolution and mode BEFORE geometry (epkowa requirement)
                self._device.x_resolution = resolution
                self._device.y_resolution = resolution
                self._device.mode = "Color"

                # Set scan region geometry
                self._device.tl_x = region.left
                self._device.tl_y = region.top
                self._device.br_x = region.left + region.width
                self._device.br_y = region.top + region.height

                # Scan: start() initiates, snap() captures the image
                self._device.start()
                image = self._device.snap()

                if image is None:
                    raise RuntimeError("snap() returned None")

                # Record raw RGB bytes received over USB. Used by the
                # WedgeDetector (#236) to distinguish "0 bytes after 120 s"
                # from "partial bytes received then failed."
                self._last_scan_bytes_received = (
                    image.width * image.height * 3
                )

                # Save as TIFF with LZW compression and metadata.
                # Compose the final filename here so `_et_` reflects the
                # actual save moment, not the scan-start moment.
                tiff_meta = _build_tiff_metadata(self.scanner_id, plate, region)
                et = datetime.now().strftime("%Y%m%dT%H%M%S")
                final_path = compose_output_path(plate, et)
                image.save(
                    final_path, "TIFF", compression="tiff_lzw", tiffinfo=tiff_meta
                )

                # Cancel to return device to IDLE state for next scan
                try:
                    self._device.cancel()
                except Exception:
                    pass

                log(self.scanner_id, f"Scan saved: {final_path}")
                return final_path

            except Exception as e:
                last_error = str(e)
                log(
                    self.scanner_id,
                    f"Scan failed (attempt {attempt + 1}/{MAX_RETRIES}): {e}",
                )
                # Device may be in a bad state — close it so next attempt reopens fresh
                self._close_device()

        # All retries exhausted
        raise RuntimeError(f"Scan failed after {MAX_RETRIES} attempts: {last_error}")

    def _close_device(self) -> None:
        """Close python-sane device to release USB (safe to call multiple times)."""
        if not self._device_is_open or self._device is None:
            return
        try:
            self._device.cancel()
        except Exception:
            pass
        try:
            self._device.close()
        except Exception:
            pass
        self._device_is_open = False

    def _reset_usb_device(self) -> None:
        """Perform a kernel-level USB device reset to flush stale transfers.

        Parses bus:device from the SANE device name and issues USBDEVFS_RESET.
        This is a soft reset — the bus:device address stays the same.
        Only runs on Linux; silently skips on other platforms.
        """
        import platform

        if platform.system() != "Linux":
            return

        try:
            import fcntl

            parts = self.device_name.split(":")
            if len(parts) < 4:
                log(
                    self.scanner_id,
                    f"Cannot parse bus:device from '{self.device_name}', skipping USB reset",
                )
                return
            bus, dev = int(parts[2]), int(parts[3])
            usb_path = f"/dev/bus/usb/{bus:03d}/{dev:03d}"
            USBDEVFS_RESET = ord("U") << 8 | 20
            fd = os.open(usb_path, os.O_WRONLY)
            try:
                fcntl.ioctl(fd, USBDEVFS_RESET, 0)
                log(self.scanner_id, f"USB device reset: {usb_path}")
            finally:
                os.close(fd)
        except Exception as e:
            log(self.scanner_id, f"USB reset failed (non-fatal): {e}")

    def _reopen_device(self) -> None:
        """Full SANE restart: exit + init + reopen to get a fresh USB connection.

        Used for error recovery when the device enters a bad state after a
        failed scan. Retries sane.open() up to 3 times internally with
        increasing delays to handle transient USB busy states on shared buses.
        """
        REOPEN_RETRIES = 3

        if self._device is not None:
            try:
                self._device.cancel()
            except Exception:
                pass
            try:
                self._device.close()
            except Exception:
                pass
        if self._sane is not None:
            try:
                self._sane.exit()
            except Exception:
                pass

        # Flush stale USB bulk transfers before SANE reinit
        self._reset_usb_device()

        # Let the USB bus settle after releasing the device
        time.sleep(3)

        log(self.scanner_id, f"Full SANE reinit for device: {self.device_name}")
        open_start = time.time()

        assert self._sane is not None

        last_err = None
        for reopen_attempt in range(REOPEN_RETRIES):
            try:
                self._sane.init()
                self._device = self._sane.open(self.device_name)
                break
            except Exception as e:
                last_err = e
                # Clean up the failed init before retrying
                try:
                    self._sane.exit()
                except Exception:
                    pass
                delay = 2 * (reopen_attempt + 1)
                log(
                    self.scanner_id,
                    f"sane.open() failed ({reopen_attempt + 1}/{REOPEN_RETRIES}): {e} — waiting {delay}s...",
                )
                time.sleep(delay)
        else:
            raise RuntimeError(
                f"Failed to reopen device after {REOPEN_RETRIES} attempts: {last_err}"
            )

        log(self.scanner_id, f"Device reopened in {time.time() - open_start:.1f}s")
        self._device_is_open = True

        assert self._device is not None

        # Re-initialize geometry
        self._device.tl_x = 0
        self._device.tl_y = 0
        max_br_x = self._device.br_x
        max_br_y = self._device.br_y
        self._device.br_x = max_br_x
        self._device.br_y = max_br_y
        self._device.cancel()

    def _mock_scan(self, plate: dict) -> str:
        """Generate a mock scan image (checkerboard pattern).

        Composes the final filename at save time including `_et_`, mirroring
        the SANE path. Returns the path written.
        """
        import numpy as np
        from PIL import Image

        plate_index = plate["plate_index"]
        grid_mode = plate["grid_mode"]
        resolution = plate["resolution"]
        region = get_scan_region(grid_mode, plate_index)
        pixels = region.to_pixels(resolution)
        width = max(pixels["width"], 100)
        height = max(pixels["height"], 100)

        # Simulate scan delay
        time.sleep(0.5)

        # Generate RGB checkerboard
        square_size = max(width // 20, 10)
        img_array = np.zeros((height, width, 3), dtype=np.uint8)
        for y in range(height):
            for x in range(width):
                if ((x // square_size) + (y // square_size)) % 2 == 0:
                    img_array[y, x] = [255, 255, 255]
                else:
                    img_array[y, x] = [128, 128, 128]

        image = Image.fromarray(img_array, mode="RGB")

        # Record raw RGB bytes (mirrors _sane_scan's behavior so the
        # scan-error/scan-complete payloads remain consistent between
        # mock and real scanners).
        self._last_scan_bytes_received = image.width * image.height * 3

        os.makedirs(plate["output_dir"], exist_ok=True)
        tiff_meta = _build_tiff_metadata(self.scanner_id, plate, region)
        et = datetime.now().strftime("%Y%m%dT%H%M%S")
        final_path = compose_output_path(plate, et)
        image.save(final_path, "TIFF", compression="tiff_lzw", tiffinfo=tiff_meta)

        log(self.scanner_id, f"Mock scan saved: {final_path}")
        return final_path

    def _shutdown(self) -> None:
        """Clean shutdown: close device and exit SANE."""
        log(self.scanner_id, "Shutting down...")

        if self._device is not None:
            try:
                self._device.close()
                log(self.scanner_id, "Device closed")
            except Exception as e:
                log(self.scanner_id, f"Error closing device: {e}")

        if self._sane is not None:
            try:
                self._sane.exit()
                log(self.scanner_id, "SANE exited")
            except Exception as e:
                log(self.scanner_id, f"Error exiting SANE: {e}")

        log(self.scanner_id, "Done")


def run_worker(scanner_id: str, device: str, mock: bool = False) -> None:
    """Entry point for scan worker — used by both dev mode and production PyInstaller.

    Creates a ScanWorker, initializes SANE, and enters the command loop.
    Exits with code 1 if initialization fails, 0 on clean exit.
    """
    worker = ScanWorker(
        scanner_id=scanner_id,
        device_name=device,
        mock=mock,
    )

    if not worker.initialize():
        sys.exit(1)

    worker.run()
    sys.exit(0)


def main():
    parser = argparse.ArgumentParser(
        description="GraviScan worker for a single scanner"
    )
    parser.add_argument(
        "--device", type=str, help="SANE device name (e.g., epkowa:interpreter:001:007)"
    )
    parser.add_argument(
        "--scanner-id", type=str, required=True, help="Scanner UUID from database"
    )
    parser.add_argument(
        "--mock", action="store_true", help="Run in mock mode (no hardware)"
    )
    args = parser.parse_args()

    if not args.mock and not args.device:
        parser.error("--device is required unless --mock is specified")

    run_worker(args.scanner_id, args.device or "mock-device", args.mock)


if __name__ == "__main__":
    main()
