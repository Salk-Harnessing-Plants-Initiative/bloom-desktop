"""
Scanner coordination for Bloom hardware interface.

Coordinates camera and DAQ for automated cylinder scanning workflow.
"""

import os
import sys
import queue
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, List, Optional, Union

import imageio.v2 as iio
import numpy as np

from .camera import Camera
from .camera_mock import MockCamera
from .camera_types import FrameNotArrivedError
from .daq import DAQ
from .daq_mock import MockDAQ
from .scan_preview import frame_preview_data_uri
from .scanner_types import ScannerSettings, ScanResult

try:
    from protocol_io import (  # type: ignore[import-not-found]
        background_writes,
        write_line,
        writes_backed_up,
    )
except ImportError:
    from python.protocol_io import (  # Development/test path
        background_writes,
        write_line,
        writes_backed_up,
    )

MICROSECONDS_PER_SECOND = 1_000_000
EXPOSURE_MARGIN_SECONDS = 0.005  # Allowed on top of the exposure before the next move
COLLECTOR_THREAD_NAME = "scan-frame-collector"
FRAME_SAVE_WORKERS = 8  # How many frames are saved at once at the end of a scan


def _one_line(error: Exception) -> str:
    """An error's text on one line, as the output protocol is line based."""
    return " ".join(str(error).split())


class Scanner:
    """Coordinates camera and DAQ for automated scanning.

    The Scanner class manages the complete scanning workflow:
    1. Initialize camera and DAQ
    2. Home the turntable to 0°
    3. For each frame:
       - Rotate to next position
       - Trigger the frame, and hold still for its exposure
       - Report progress
    4. Return turntable to home
    5. Save the frames
    6. Cleanup resources

    Uses mock hardware when BLOOM_USE_MOCK_HARDWARE=true (default).
    """

    def __init__(self, settings: ScannerSettings):
        """Initialize scanner with configuration settings.

        Args:
            settings: Scanner configuration including camera and DAQ settings
        """
        self.settings = settings
        self.camera: Optional[Union[Camera, MockCamera]] = None
        self.daq: Optional[Union[DAQ, MockDAQ]] = None
        self.is_initialized = False
        self.is_scanning = False

        # Determine if we should use mock hardware
        self._use_mock = os.getenv("BLOOM_USE_MOCK_HARDWARE", "true").lower() == "true"

    def initialize(self) -> None:
        """Initialize camera and DAQ hardware.

        Raises:
            RuntimeError: If initialization fails
        """
        if self.is_initialized:
            write_line("STATUS:Scanner already initialized")
            return

        try:
            # Initialize camera
            if self._use_mock:
                write_line("STATUS:Using mock camera for scanner")
                self.camera = MockCamera(self.settings.camera)
            else:
                write_line("STATUS:Using real camera for scanner")
                self.camera = Camera(self.settings.camera)

            self.camera.open()
            write_line("STATUS:Scanner camera initialized")

            # Initialize DAQ
            if self._use_mock:
                write_line("STATUS:Using mock DAQ for scanner")
                self.daq = MockDAQ(self.settings.daq)
            else:
                write_line("STATUS:Using real DAQ for scanner")
                self.daq = DAQ(self.settings.daq)

            self.daq.initialize()
            write_line("STATUS:Scanner DAQ initialized")

            self.is_initialized = True
            write_line("STATUS:Scanner initialized successfully")

        except Exception as e:
            error_msg = f"Scanner initialization failed: {str(e)}"
            print(f"ERROR:{error_msg}", file=sys.stderr, flush=True)
            self.cleanup()
            raise RuntimeError(error_msg)

    def cleanup(self) -> None:
        """Cleanup camera and DAQ resources.

        Raises:
            RuntimeError: If cleanup attempted during active scan, or if
                called from a thread other than the main IPC thread (#40 —
                belt-and-suspenders runtime tripwire; the single-threaded
                calling architecture this relies on is otherwise unverified
                at runtime).
        """
        if threading.current_thread() is not threading.main_thread():
            raise RuntimeError(
                "Scanner.cleanup() must be called from the main IPC thread"
            )

        if self.is_scanning:
            raise RuntimeError("Cannot cleanup during active scan")

        try:
            if self.camera is not None:
                self.camera.close()
                write_line("STATUS:Scanner camera cleaned up")
        except Exception as e:
            # stderr — a separate OS pipe from stdout, so it cannot interleave
            # with a FRAME: write regardless of locking (#316 design.md).
            print(
                f"WARNING:Scanner camera cleanup failed: {str(e)}",
                file=sys.stderr,
                flush=True,
            )

        try:
            if self.daq is not None:
                self.daq.cleanup()
                write_line("STATUS:Scanner DAQ cleaned up")
        except Exception as e:
            print(
                f"WARNING:Scanner DAQ cleanup failed: {str(e)}",
                file=sys.stderr,
                flush=True,
            )

        self.camera = None
        self.daq = None
        self.is_initialized = False
        write_line("STATUS:Scanner cleanup complete")

    @staticmethod
    def _collect_frames(
        camera: Union[Camera, MockCamera],
        triggered: "queue.Queue[Optional[int]]",
        frames: List[Optional[np.ndarray]],
        on_preview: Optional[Callable[[str], None]],
    ) -> None:
        """Collect each triggered frame, and send its picture to the page.

        Runs on a background thread, until it's told there are no more frames.

        Args:
            camera: The camera to collect from
            triggered: The frame numbers as they're triggered, then None
            frames: Where each collected frame goes
            on_preview: Optional callback receiving each frame's picture, unless
                output is backed up
        """
        positions_known = True
        while (frame_idx := triggered.get()) is not None:
            if not positions_known:
                continue
            try:
                image = camera.retrieve_next_frame()
            except FrameNotArrivedError as e:
                # Frames are placed by arrival order, so nothing shows which one is
                # missing or which angle the others belong to. Trust none of them, and
                # don't wait for the rest: they're likely not coming either.
                positions_known = False
                frames[:] = [None] * len(frames)
                write_line(
                    f"STATUS:A frame didn't arrive, so positions are unknown: {_one_line(e)}"
                )
                continue
            except Exception as e:
                # This frame's slot was used, so the others keep their places.
                write_line(
                    f"STATUS:Couldn't collect frame {frame_idx + 1}: {_one_line(e)}"
                )
                continue
            frames[frame_idx] = image
            # A picture is the one thing a scan can do without if the app falls behind.
            if image is None or on_preview is None or writes_backed_up():
                continue
            try:
                on_preview(frame_preview_data_uri(image))
            except Exception as e:
                # Only a picture on the page, so it must never fail the scan.
                write_line(f"STATUS:Couldn't send a scan preview: {_one_line(e)}")

    def _save_frames(self, frames: list, output_dir: Path) -> int:
        """Save the scan's frames in parallel, named by their position in the scan.

        Args:
            frames: One entry per frame: its image, or None if that frame failed
            output_dir: Folder to save into

        Returns:
            How many frames were saved
        """

        def save(frame_idx: int, image: Any) -> None:
            # Pilot-compatible naming: 001.png, 002.png, ...
            # Reference: pilot pylon.py:62 uses f'{i + 1:03d}.png'
            # Use pathlib with .as_posix() for cross-platform path handling
            filepath = output_dir / f"{frame_idx + 1:03d}.png"
            iio.imwrite(filepath.as_posix(), image)

        saved = 0
        write_line(f"STATUS:Saving {len(frames)} frames")
        with ThreadPoolExecutor(max_workers=FRAME_SAVE_WORKERS) as executor:
            futures = []
            for frame_idx, image in enumerate(frames):
                if image is None:
                    # Not stderr: that rejects the scan before its result can arrive.
                    write_line(f"STATUS:Frame {frame_idx + 1} capture failed")
                else:
                    futures.append(executor.submit(save, frame_idx, image))
            for future in futures:
                future.result()
                saved += 1
        return saved

    def perform_scan(
        self,
        on_frame: Optional[Callable[[int, float], None]] = None,
        on_preview: Optional[Callable[[str], None]] = None,
    ) -> ScanResult:
        """Perform a complete scan of the cylinder.

        Workflow:
        1. Home turntable to 0°
        2. For each frame:
           - Rotate to position
           - Trigger the frame, and hold still for its exposure
           - Call progress callback
           - In the background, collect the frame and send its picture
        3. Return to home position
        4. Save the frames, all together

        Args:
            on_frame: Optional callback function called after each frame is taken.
                     Receives (frame_number, position_degrees).
            on_preview: Optional callback function called from a background thread
                     with a small picture of each frame, as a data URI. Pictures are
                     skipped if the app is slow to read them.

        Returns:
            ScanResult with success status, frames captured, and output path

        Raises:
            RuntimeError: If scanner not initialized, scan already in
                progress, scan fails, or called from a thread other than
                the main IPC thread (#40 — belt-and-suspenders runtime
                tripwire; the single-threaded calling architecture this
                relies on is otherwise unverified at runtime).
        """
        if threading.current_thread() is not threading.main_thread():
            raise RuntimeError(
                "Scanner.perform_scan() must be called from the main IPC thread"
            )

        if not self.is_initialized:
            raise RuntimeError("Scanner not initialized. Call initialize() first.")

        if self.is_scanning:
            raise RuntimeError("Scan already in progress")

        if self.camera is None or self.daq is None:
            raise RuntimeError("Scanner hardware not available")

        num_frames = self.settings.num_frames
        output_dir = Path(self.settings.output_path)
        frames_captured = 0

        self.is_scanning = True
        try:
            # Create output directory if it doesn't exist (cross-platform)
            output_dir.mkdir(parents=True, exist_ok=True)

            # Calculate rotation per frame
            degrees_per_frame = 360.0 / num_frames

            write_line(
                f"STATUS:Starting scan: {num_frames} frames, {degrees_per_frame:.2f}° per frame"
            )

            # Home the turntable
            self.daq.home()
            write_line("STATUS:Turntable homed to 0°")

            # Take the frames without stopping to save them, so the turntable keeps going
            # as it does in the pilot app. A background thread collects each frame, and
            # sends its picture to the page, so that doesn't hold up the moves either.
            hold_seconds = (
                self.settings.camera.exposure_time / MICROSECONDS_PER_SECOND
                + EXPOSURE_MARGIN_SECONDS
            )
            frames: List[Optional[np.ndarray]] = [None] * num_frames
            triggered: "queue.Queue[Optional[int]]" = queue.Queue()
            collector = threading.Thread(
                target=self._collect_frames,
                args=(self.camera, triggered, frames, on_preview),
                name=COLLECTOR_THREAD_NAME,
                daemon=True,
            )
            self.camera.start_triggered_capture(num_frames)
            collector.start()
            # Nothing in the turn waits for the app to read our output.
            with background_writes():
                try:
                    for frame_idx in range(num_frames):
                        # Rotate to next position
                        self.daq.rotate(degrees_per_frame)

                        # Get current position
                        position = self.daq.get_position()

                        # Capture image, holding still for the exposure so it isn't blurred
                        write_line(
                            f"STATUS:Capturing frame {frame_idx + 1}/{num_frames} at {position:.2f}°"
                        )
                        self.camera.trigger_frame()
                        triggered.put(frame_idx)
                        time.sleep(hold_seconds)

                        # Call progress callback if provided
                        if on_frame is not None:
                            on_frame(frame_idx, position)
                finally:
                    triggered.put(None)
                    collector.join()
                    self.camera.stop_triggered_capture()

            # Return to home
            self.daq.home()
            write_line("STATUS:Turntable returned to home position")

            frames_captured = self._save_frames(frames, output_dir)

            # Report results
            success = frames_captured == num_frames
            if success:
                write_line(
                    f"STATUS:Scan completed successfully: {frames_captured}/{num_frames} frames"
                )
            else:
                write_line(
                    f"STATUS:Scan completed with errors: {frames_captured}/{num_frames} frames"
                )

            return ScanResult(
                success=success,
                frames_captured=frames_captured,
                output_path=output_dir.as_posix(),
                error=(
                    None
                    if success
                    else f"Only {frames_captured}/{num_frames} frames captured"
                ),
            )

        except Exception as e:
            error_msg = f"Scan failed: {str(e)}"
            print(f"ERROR:{error_msg}", file=sys.stderr, flush=True)

            # Attempt to return home
            try:
                if self.daq is not None:
                    self.daq.home()
            except Exception as home_error:
                # The next scan would start from wherever the turntable stopped.
                write_line(f"STATUS:Couldn't return home: {home_error}")
                error_msg += (
                    " The turntable didn't return to its start position. "
                    "Check it before the next scan."
                )

            return ScanResult(
                success=False,
                frames_captured=frames_captured,
                output_path=output_dir.as_posix(),
                error=error_msg,
            )

        finally:
            self.is_scanning = False

    def get_status(self) -> dict:
        """Get current scanner status.

        Returns:
            Dictionary with scanner status information
        """
        camera_status = "unknown"
        daq_status = "unknown"
        position = 0.0

        if self.camera is not None:
            camera_status = "connected" if self.camera.is_open else "disconnected"

        if self.daq is not None:
            daq_status = "initialized" if self.daq.is_initialized else "not_initialized"
            if self.daq.is_initialized:
                position = self.daq.get_position()

        return {
            "initialized": self.is_initialized,
            "camera_status": camera_status,
            "daq_status": daq_status,
            "position": position,
            "mock": self._use_mock,
        }


class MockScanner(Scanner):
    """Mock scanner for testing without hardware.

    Simulates scanner behavior without requiring actual camera or DAQ hardware.
    Useful for development and testing.
    """

    def __init__(self, settings: ScannerSettings):
        """Initialize mock scanner.

        Args:
            settings: Scanner configuration
        """
        super().__init__(settings)
        self._use_mock = True
