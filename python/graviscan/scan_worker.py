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
        {"action":"scan","plates":[{"plate_index":"00","grid_mode":"2grid","resolution":300,"output_path":"/tmp/scan.jpg"}, ...]}
        {"action":"cancel"}
        {"action":"quit"}

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

from .scan_regions import (
    get_scan_region,
    get_row_groups,
    get_row_bounding_box,
    get_crop_box,
)

# Application version embedded in TIFF metadata
_BLOOM_VERSION = "0.1.0"


def _build_tiff_metadata(
    scanner_id: str,
    grid_mode: str,
    plate_index: str,
    resolution: int,
    region,
) -> ImageFileDirectory_v2:
    """Build TIFF metadata tags for a scan image.

    Embeds scan provenance into standard TIFF tags so files are self-describing.
    Structured metadata goes into ImageDescription as JSON.
    """
    ifd = ImageFileDirectory_v2()
    ifd[270] = json.dumps(
        {  # ImageDescription
            "scanner_id": scanner_id,
            "grid_mode": grid_mode,
            "plate_index": plate_index,
            "resolution_dpi": resolution,
            "scan_region_mm": {
                "top": region.top,
                "left": region.left,
                "width": region.width,
                "height": region.height,
            },
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
            INIT_RETRIES = 10
            for init_attempt in range(INIT_RETRIES):
                try:
                    self._device = sane.open(self.device_name)
                    break
                except Exception as e:
                    try:
                        sane.exit()
                    except Exception:
                        pass
                    delay = 5 * (init_attempt + 1)
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
        """Handle a scan command — scan plates, using row-merge for 4grid."""
        plates = cmd.get("plates", [])
        if not plates:
            log(self.scanner_id, "Scan command with no plates, ignoring")
            return

        with self._cancel_lock:
            self._cancel_requested = False

        self._cycle += 1

        # Check if row-merge is possible: all plates must be 4grid
        grid_mode = plates[0].get("grid_mode", "2grid")
        use_row_merge = grid_mode == "4grid" and len(plates) > 1

        if use_row_merge:
            # Group plates by row
            row_groups = get_row_groups(grid_mode)
            plate_by_index = {p["plate_index"]: p for p in plates}

            for row_name, row_indices in row_groups.items():
                with self._cancel_lock:
                    if self._cancel_requested:
                        break

                # Only include plates that were actually requested
                row_plates = [
                    plate_by_index[idx] for idx in row_indices if idx in plate_by_index
                ]
                if not row_plates:
                    continue

                if len(row_plates) >= 2:
                    # Row-merge: scan bounding box once, crop plates
                    self._scan_row(row_plates)
                else:
                    # Single plate in this row — scan individually
                    self._scan_plate(row_plates[0])
        else:
            # 2grid or single plate — scan each individually
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
        """Scan a single plate."""
        plate_index = plate.get("plate_index", "00")
        grid_mode = plate.get("grid_mode", "2grid")
        resolution = plate.get("resolution", 300)
        output_path = plate.get("output_path", "/tmp/scan.jpg")
        job_id = str(uuid.uuid4())

        emit_event(
            {
                "type": "scan-started",
                "scanner_id": self.scanner_id,
                "plate_index": plate_index,
                "job_id": job_id,
            }
        )

        start_time = time.time()

        try:
            if self.mock:
                self._mock_scan(grid_mode, plate_index, resolution, output_path)
            else:
                self._sane_scan(grid_mode, plate_index, resolution, output_path)

            duration_ms = int((time.time() - start_time) * 1000)

            emit_event(
                {
                    "type": "scan-complete",
                    "scanner_id": self.scanner_id,
                    "plate_index": plate_index,
                    "job_id": job_id,
                    "path": output_path,
                    "duration_ms": duration_ms,
                }
            )

        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            log(self.scanner_id, f"Scan error (plate {plate_index}): {e}")

            emit_event(
                {
                    "type": "scan-error",
                    "scanner_id": self.scanner_id,
                    "plate_index": plate_index,
                    "job_id": job_id,
                    "error": str(e),
                    "duration_ms": duration_ms,
                }
            )

    def _sane_scan(
        self,
        grid_mode: str,
        plate_index: str,
        resolution: int,
        output_path: str,
    ) -> None:
        """Perform a scan using python-sane directly.

        Uses x_resolution/y_resolution (epkowa per-axis options) instead of the
        generic resolution option which only supports [400,800,1600,3200].
        Critical: resolution and mode must be set BEFORE geometry for epkowa.

        The device stays open between scans. On failure, the device is closed
        and reopened on the next attempt.

        Retries up to 5 times with exponential backoff on failure.
        """
        MAX_RETRIES = 5
        region = get_scan_region(grid_mode, plate_index)

        log(
            self.scanner_id,
            f"Scanning plate {plate_index} ({grid_mode}) at {resolution}dpi "
            f"region=({region.left},{region.top})-({region.left+region.width},{region.top+region.height})",
        )

        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

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

                # Save as TIFF with LZW compression and metadata
                tiff_meta = _build_tiff_metadata(
                    self.scanner_id, grid_mode, plate_index, resolution, region
                )
                image.save(
                    output_path, "TIFF", compression="tiff_lzw", tiffinfo=tiff_meta
                )

                # Cancel to return device to IDLE state for next scan
                try:
                    self._device.cancel()
                except Exception:
                    pass

                log(self.scanner_id, f"Scan saved: {output_path}")
                return

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
        """Reopen device without full SANE reinit to avoid disrupting other scanners.

        Closes the device then reopens using the existing SANE session.
        Does NOT reset USB — USB reset causes device re-enumeration which
        changes the device number, making the SANE device name invalid.
        """
        REOPEN_RETRIES = 5

        if self._device is not None:
            try:
                self._device.cancel()
            except Exception:
                pass
            try:
                self._device.close()
            except Exception:
                pass
        self._device_is_open = False

        time.sleep(3)

        log(self.scanner_id, f"Reopening device: {self.device_name}")
        open_start = time.time()

        assert self._sane is not None

        last_err = None
        for reopen_attempt in range(REOPEN_RETRIES):
            try:
                self._device = self._sane.open(self.device_name)
                self._device_is_open = True
                break
            except Exception as e:
                last_err = e
                delay = 5 * (reopen_attempt + 1)
                log(
                    self.scanner_id,
                    f"Reopen failed ({reopen_attempt + 1}/{REOPEN_RETRIES}): {e} — waiting {delay}s...",
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

    def _mock_scan(
        self, grid_mode: str, plate_index: str, resolution: int, output_path: str
    ) -> None:
        """Generate a mock scan image (checkerboard pattern)."""
        import numpy as np
        from PIL import Image

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

        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        tiff_meta = _build_tiff_metadata(
            self.scanner_id, grid_mode, plate_index, resolution, region
        )
        image.save(output_path, "TIFF", compression="tiff_lzw", tiffinfo=tiff_meta)

        log(self.scanner_id, f"Mock scan saved: {output_path}")

    def _scan_row(self, row_plates: list) -> None:
        """Scan a row of plates using row-merge: one scan, crop each plate."""
        grid_mode = row_plates[0].get("grid_mode", "4grid")
        resolution = row_plates[0].get("resolution", 300)
        plate_indices = [p["plate_index"] for p in row_plates]

        # Emit scan-started for all plates in the row
        job_ids = {}
        for plate in row_plates:
            job_id = str(uuid.uuid4())
            job_ids[plate["plate_index"]] = job_id
            emit_event(
                {
                    "type": "scan-started",
                    "scanner_id": self.scanner_id,
                    "plate_index": plate["plate_index"],
                    "job_id": job_id,
                }
            )

        start_time = time.time()

        try:
            bbox = get_row_bounding_box(grid_mode, plate_indices)

            if self.mock:
                row_image = self._mock_scan_row(bbox, resolution)
            else:
                row_image = self._sane_scan_row(bbox, resolution)

            # Crop and save each plate
            for plate in row_plates:
                crop_box = get_crop_box(
                    grid_mode, plate["plate_index"], bbox, resolution
                )
                plate_image = row_image.crop(crop_box)
                output_path = plate["output_path"]
                plate_region = get_scan_region(grid_mode, plate["plate_index"])
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                tiff_meta = _build_tiff_metadata(
                    self.scanner_id,
                    grid_mode,
                    plate["plate_index"],
                    resolution,
                    plate_region,
                )
                plate_image.save(
                    output_path, "TIFF", compression="tiff_lzw", tiffinfo=tiff_meta
                )
                log(
                    self.scanner_id,
                    f"Cropped plate {plate['plate_index']} saved: {output_path}",
                )

            duration_ms = int((time.time() - start_time) * 1000)

            # Emit scan-complete for each plate
            for plate in row_plates:
                emit_event(
                    {
                        "type": "scan-complete",
                        "scanner_id": self.scanner_id,
                        "plate_index": plate["plate_index"],
                        "job_id": job_ids[plate["plate_index"]],
                        "path": plate["output_path"],
                        "duration_ms": duration_ms,
                    }
                )

        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            log(self.scanner_id, f"Row scan error ({plate_indices}): {e}")
            for plate in row_plates:
                emit_event(
                    {
                        "type": "scan-error",
                        "scanner_id": self.scanner_id,
                        "plate_index": plate["plate_index"],
                        "job_id": job_ids[plate["plate_index"]],
                        "error": str(e),
                        "duration_ms": duration_ms,
                    }
                )

    def _sane_scan_row(self, bbox, resolution: int):
        """Scan a row bounding box and return the PIL Image (no save).

        Uses the same python-sane approach as _sane_scan() but with
        the bounding box region and returns the image for cropping.
        """

        MAX_RETRIES = 5
        last_error = None

        log(
            self.scanner_id,
            f"Row-merge scan at {resolution}dpi "
            f"bbox=({bbox.left},{bbox.top})-({bbox.left+bbox.width},{bbox.top+bbox.height})",
        )

        for attempt in range(MAX_RETRIES):
            if attempt > 0:
                backoff = min(2 * (attempt + 1), 15)
                log(
                    self.scanner_id,
                    f"Retry backoff: waiting {backoff}s before attempt {attempt + 1}/{MAX_RETRIES}...",
                )
                time.sleep(backoff)

            try:
                if not self._device_is_open:
                    self._reopen_device()

                assert self._device is not None

                # Set resolution and mode BEFORE geometry (epkowa requirement)
                self._device.x_resolution = resolution
                self._device.y_resolution = resolution
                self._device.mode = "Color"

                # Set bounding box geometry
                self._device.tl_x = bbox.left
                self._device.tl_y = bbox.top
                self._device.br_x = bbox.left + bbox.width
                self._device.br_y = bbox.top + bbox.height

                self._device.start()
                image = self._device.snap()

                if image is None:
                    raise RuntimeError("snap() returned None")

                try:
                    self._device.cancel()
                except Exception:
                    pass

                log(
                    self.scanner_id,
                    f"Row-merge scan complete: {image.size[0]}x{image.size[1]} px",
                )
                return image

            except Exception as e:
                last_error = str(e)
                log(
                    self.scanner_id,
                    f"Row scan failed (attempt {attempt + 1}/{MAX_RETRIES}): {e}",
                )
                self._close_device()

        raise RuntimeError(
            f"Row scan failed after {MAX_RETRIES} attempts: {last_error}"
        )

    def _mock_scan_row(self, bbox, resolution: int):
        """Generate a mock row scan image (checkerboard) and return PIL Image."""
        import numpy as np
        from PIL import Image

        pixels = bbox.to_pixels(resolution)
        width = max(pixels["width"], 100)
        height = max(pixels["height"], 100)

        time.sleep(0.5)

        square_size = max(width // 20, 10)
        img_array = np.zeros((height, width, 3), dtype=np.uint8)
        for y in range(height):
            for x in range(width):
                if ((x // square_size) + (y // square_size)) % 2 == 0:
                    img_array[y, x] = [255, 255, 255]
                else:
                    img_array[y, x] = [128, 128, 128]

        return Image.fromarray(img_array, mode="RGB")

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
