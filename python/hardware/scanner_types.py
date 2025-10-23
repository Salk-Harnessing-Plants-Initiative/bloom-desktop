"""
Scanner type definitions for Bloom hardware interface.

Defines the data structures for scanner configuration, progress, and results.
"""

from dataclasses import dataclass
from typing import Optional, Union, Any

from .camera_types import CameraSettings
from .daq_types import DAQSettings


@dataclass
class ScannerSettings:
    """Configuration settings for scanner coordination.

    Attributes:
        camera: Camera configuration settings
        daq: DAQ configuration settings
        num_frames: Number of frames to capture during full rotation (default: 72)
        output_path: Directory path for saving captured images (default: "./scans")
    """

    camera: Union[CameraSettings, Any]
    daq: Union[DAQSettings, Any]
    num_frames: int = 72
    output_path: str = "./scans"

    def __post_init__(self):
        """Validate scanner settings values and convert dicts to proper types."""
        # Convert dicts to dataclass instances if needed
        if isinstance(self.camera, dict):
            self.camera = CameraSettings(**self.camera)

        if isinstance(self.daq, dict):
            self.daq = DAQSettings(**self.daq)

        if self.num_frames <= 0:
            raise ValueError(f"num_frames must be positive, got {self.num_frames}")

        if not self.output_path:
            raise ValueError("output_path cannot be empty")

        # Ensure camera and daq num_frames match
        if self.camera.num_frames != self.num_frames:
            self.camera.num_frames = self.num_frames

        if self.daq.num_frames != self.num_frames:
            self.daq.num_frames = self.num_frames


@dataclass
class ScanProgress:
    """Progress information for an ongoing scan.

    Attributes:
        frame_number: Current frame number (0-indexed)
        total_frames: Total number of frames in the scan
        position: Current turntable position in degrees
        image_path: Path to the captured image (if available)
    """

    frame_number: int
    total_frames: int
    position: float
    image_path: Optional[str] = None


@dataclass
class ScanResult:
    """Result information from a completed scan.

    Attributes:
        success: Whether the scan completed successfully
        frames_captured: Number of frames successfully captured
        output_path: Directory path where images were saved
        error: Error message if scan failed (None if successful)
    """

    success: bool
    frames_captured: int
    output_path: str
    error: Optional[str] = None
