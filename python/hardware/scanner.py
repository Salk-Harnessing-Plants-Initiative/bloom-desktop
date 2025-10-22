"""
Scanner coordination for camera + DAQ turntable scanning.

This module coordinates the camera and DAQ systems to perform automated
multi-angle scanning workflows, based on the pilot's pylon_rot.py implementation.
"""

import os
import time
from typing import Optional, Callable
from .scanner_types import ScannerSettings, ScanProgress, ScanResult

# Import with fallback for bundled vs development paths
try:
    from hardware.camera import Camera
    from hardware.camera_mock import MockCamera
    from hardware.daq import DAQ
    from hardware.daq_mock import MockDAQ
except ImportError:
    from python.hardware.camera import Camera
    from python.hardware.camera_mock import MockCamera
    from python.hardware.daq import DAQ
    from python.hardware.daq_mock import MockDAQ


class Scanner:
    """
    Coordinates camera and DAQ for automated scanning.

    Based on pilot's pylon_rot.py grab_frames() implementation.
    """

    def __init__(self, settings: ScannerSettings):
        """
        Initialize scanner with settings.

        Args:
            settings: Scanner configuration including camera and DAQ settings
        """
        self.settings = settings
        self.camera: Optional[Camera | MockCamera] = None
        self.daq: Optional[DAQ | MockDAQ] = None
        self.is_initialized = False
        self._use_mock = os.getenv("BLOOM_USE_MOCK_HARDWARE", "true").lower() == "true"

    def initialize(self) -> bool:
        """
        Initialize both camera and DAQ.

        Returns:
            True if both initialized successfully, False otherwise
        """
        print("STATUS:Initializing scanner...", flush=True)

        # Create camera and DAQ instances
        if self._use_mock:
            print("STATUS:Using mock hardware", flush=True)
            self.camera = MockCamera(self.settings.camera)
            self.daq = MockDAQ(self.settings.daq)
        else:
            print("STATUS:Using real hardware", flush=True)
            self.camera = Camera(self.settings.camera)
            self.daq = DAQ(self.settings.daq)

        # Initialize both
        camera_ok = self.camera.initialize()
        daq_ok = self.daq.initialize()

        self.is_initialized = camera_ok and daq_ok

        if self.is_initialized:
            print("STATUS:Scanner initialized successfully", flush=True)
        else:
            print(
                f"ERROR:Scanner initialization failed (camera: {camera_ok}, daq: {daq_ok})",
                flush=True,
            )

        return self.is_initialized

    def perform_scan(
        self,
        on_frame: Optional[Callable[[int, float], None]] = None,
    ) -> ScanResult:
        """
        Perform automated scan.

        Based on pilot's grab_frames() logic:
        1. Home the turntable
        2. For each frame:
           - Rotate to next position
           - Trigger camera capture
           - Emit progress
        3. Retrieve all captured images
        4. Return home

        Args:
            on_frame: Optional callback(frame_idx, position) called after each frame

        Returns:
            ScanResult with success status and metadata
        """
        if not self.is_initialized:
            return ScanResult(
                success=False,
                frames_captured=0,
                output_path=self.settings.output_path,
                error="Scanner not initialized",
            )

        num_frames = self.settings.num_frames
        degrees_per_frame = 360.0 / num_frames

        print("STATUS:Scan started", flush=True)
        print(
            f"STATUS:Scanning {num_frames} frames at {degrees_per_frame:.2f}° per frame",
            flush=True,
        )

        frames_captured = 0

        try:
            # Home position
            print("STATUS:Homing turntable...", flush=True)
            self.daq.home()

            # Capture loop
            for frame_idx in range(num_frames):
                # Rotate to next position
                rotate_success = self.daq.rotate(degrees_per_frame)
                if not rotate_success:
                    raise RuntimeError(f"Rotation failed at frame {frame_idx}")

                # Small delay for motion settling (pilot uses wait_until_done polling)
                time.sleep(0.05)

                # Get current position
                position = self.daq.get_position()

                # Trigger camera (pilot uses software trigger)
                print("TRIGGER_CAMERA", flush=True)

                # Capture image
                image_success = self.camera.capture()
                if not image_success:
                    raise RuntimeError(f"Capture failed at frame {frame_idx}")

                frames_captured += 1

                # Emit progress (pilot prints TRIGGER_CAMERA for each frame)
                progress = ScanProgress(
                    frame_number=frame_idx + 1,
                    total_frames=num_frames,
                    position=position,
                )
                print(
                    f"DATA:{{'type': 'scan_progress', 'data': {progress.to_dict()}}}",
                    flush=True,
                )

                # Call progress callback
                if on_frame:
                    on_frame(frame_idx, position)

            # Return home
            print("STATUS:Returning to home position...", flush=True)
            self.daq.home()

            print("STATUS:Scan completed successfully", flush=True)

            return ScanResult(
                success=True,
                frames_captured=frames_captured,
                output_path=self.settings.output_path,
            )

        except Exception as e:
            print(f"ERROR:Scan failed: {e}", flush=True)
            # Try to return home on error
            try:
                if self.daq:
                    self.daq.home()
            except Exception as home_error:
                print(
                    f"ERROR:Failed to return home after error: {home_error}",
                    flush=True,
                )

            return ScanResult(
                success=False,
                frames_captured=frames_captured,
                output_path=self.settings.output_path,
                error=str(e),
            )

    def cleanup(self) -> None:
        """Clean up camera and DAQ resources."""
        print("STATUS:Cleaning up scanner...", flush=True)

        if self.camera:
            try:
                self.camera.cleanup()
            except Exception as e:
                print(f"ERROR:Camera cleanup failed: {e}", flush=True)

        if self.daq:
            try:
                self.daq.cleanup()
            except Exception as e:
                print(f"ERROR:DAQ cleanup failed: {e}", flush=True)

        self.is_initialized = False
        print("STATUS:Scanner cleanup complete", flush=True)

    def get_status(self) -> dict:
        """
        Get current scanner status.

        Returns:
            Dictionary with initialization status
        """
        return {
            "initialized": self.is_initialized,
            "camera_initialized": self.camera is not None
            and getattr(self.camera, "is_initialized", False),
            "daq_initialized": self.daq is not None
            and getattr(self.daq, "is_initialized", False),
            "use_mock": self._use_mock,
        }
