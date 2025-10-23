"""
Scanner coordination for Bloom hardware interface.

Coordinates camera and DAQ for automated cylinder scanning workflow.
"""

import os
import sys
import time
from typing import Callable, Optional

from .camera import Camera
from .camera_mock import MockCamera
from .daq import DAQ
from .daq_mock import MockDAQ
from .scanner_types import ScannerSettings, ScanResult


class Scanner:
    """Coordinates camera and DAQ for automated scanning.

    The Scanner class manages the complete scanning workflow:
    1. Initialize camera and DAQ
    2. Home the turntable to 0°
    3. For each frame:
       - Rotate to next position
       - Wait for stabilization
       - Capture image
       - Report progress
    4. Return turntable to home
    5. Cleanup resources

    Uses mock hardware when BLOOM_USE_MOCK_HARDWARE=true (default).
    """

    def __init__(self, settings: ScannerSettings):
        """Initialize scanner with configuration settings.

        Args:
            settings: Scanner configuration including camera and DAQ settings
        """
        self.settings = settings
        self.camera: Optional[Camera | MockCamera] = None
        self.daq: Optional[DAQ | MockDAQ] = None
        self.is_initialized = False

        # Determine if we should use mock hardware
        self._use_mock = os.getenv("BLOOM_USE_MOCK_HARDWARE", "true").lower() == "true"

    def initialize(self) -> None:
        """Initialize camera and DAQ hardware.

        Raises:
            RuntimeError: If initialization fails
        """
        if self.is_initialized:
            print("STATUS:Scanner already initialized", flush=True)
            return

        try:
            # Initialize camera
            if self._use_mock:
                print("STATUS:Using mock camera for scanner", flush=True)
                self.camera = MockCamera(self.settings.camera)
            else:
                print("STATUS:Using real camera for scanner", flush=True)
                self.camera = Camera(self.settings.camera)

            self.camera.open()
            print("STATUS:Scanner camera initialized", flush=True)

            # Initialize DAQ
            if self._use_mock:
                print("STATUS:Using mock DAQ for scanner", flush=True)
                self.daq = MockDAQ(self.settings.daq)
            else:
                print("STATUS:Using real DAQ for scanner", flush=True)
                self.daq = DAQ(self.settings.daq)

            self.daq.initialize()
            print("STATUS:Scanner DAQ initialized", flush=True)

            self.is_initialized = True
            print("STATUS:Scanner initialized successfully", flush=True)

        except Exception as e:
            error_msg = f"Scanner initialization failed: {str(e)}"
            print(f"ERROR:{error_msg}", file=sys.stderr, flush=True)
            self.cleanup()
            raise RuntimeError(error_msg)

    def cleanup(self) -> None:
        """Cleanup camera and DAQ resources."""
        try:
            if self.camera is not None:
                self.camera.close()
                print("STATUS:Scanner camera cleaned up", flush=True)
        except Exception as e:
            print(
                f"WARNING:Scanner camera cleanup failed: {str(e)}",
                file=sys.stderr,
                flush=True,
            )

        try:
            if self.daq is not None:
                self.daq.cleanup()
                print("STATUS:Scanner DAQ cleaned up", flush=True)
        except Exception as e:
            print(
                f"WARNING:Scanner DAQ cleanup failed: {str(e)}",
                file=sys.stderr,
                flush=True,
            )

        self.camera = None
        self.daq = None
        self.is_initialized = False
        print("STATUS:Scanner cleanup complete", flush=True)

    def perform_scan(
        self, on_frame: Optional[Callable[[int, float], None]] = None
    ) -> ScanResult:
        """Perform a complete scan of the cylinder.

        Workflow:
        1. Home turntable to 0°
        2. For each frame:
           - Rotate to position
           - Wait for stabilization (50ms)
           - Capture image
           - Call progress callback
        3. Return to home position

        Args:
            on_frame: Optional callback function called after each frame capture.
                     Receives (frame_number, position_degrees).

        Returns:
            ScanResult with success status, frames captured, and output path

        Raises:
            RuntimeError: If scanner not initialized or scan fails
        """
        if not self.is_initialized:
            raise RuntimeError("Scanner not initialized. Call initialize() first.")

        if self.camera is None or self.daq is None:
            raise RuntimeError("Scanner hardware not available")

        num_frames = self.settings.num_frames
        output_path = self.settings.output_path
        frames_captured = 0

        try:
            # Calculate rotation per frame
            degrees_per_frame = 360.0 / num_frames

            print(
                f"STATUS:Starting scan: {num_frames} frames, {degrees_per_frame:.2f}° per frame",
                flush=True,
            )

            # Home the turntable
            self.daq.home()
            print("STATUS:Turntable homed to 0°", flush=True)

            # Capture frames
            for frame_idx in range(num_frames):
                # Rotate to next position
                self.daq.rotate(degrees_per_frame)

                # Wait for stabilization
                time.sleep(0.05)

                # Get current position
                position = self.daq.get_position()

                # Capture image
                print(
                    f"STATUS:Capturing frame {frame_idx + 1}/{num_frames} at {position:.2f}°",
                    flush=True,
                )
                image = self.camera.grab_frame()

                if image is not None:
                    frames_captured += 1

                    # Call progress callback if provided
                    if on_frame is not None:
                        on_frame(frame_idx, position)
                else:
                    print(
                        f"WARNING:Frame {frame_idx + 1} capture failed",
                        file=sys.stderr,
                        flush=True,
                    )

            # Return to home
            self.daq.home()
            print("STATUS:Turntable returned to home position", flush=True)

            # Report results
            success = frames_captured == num_frames
            if success:
                print(
                    f"STATUS:Scan completed successfully: {frames_captured}/{num_frames} frames",
                    flush=True,
                )
            else:
                print(
                    f"WARNING:Scan completed with errors: {frames_captured}/{num_frames} frames",
                    file=sys.stderr,
                    flush=True,
                )

            return ScanResult(
                success=success,
                frames_captured=frames_captured,
                output_path=output_path,
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
            except Exception:
                pass

            return ScanResult(
                success=False,
                frames_captured=frames_captured,
                output_path=output_path,
                error=error_msg,
            )

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
