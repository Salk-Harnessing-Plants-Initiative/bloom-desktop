"""
Scanner type definitions for coordinated camera + DAQ scanning.

This module provides type definitions for scanner configuration and scan results.
"""

from dataclasses import dataclass
from typing import Optional
from .camera_types import CameraSettings
from .daq_types import DAQSettings


@dataclass
class ScannerSettings:
    """Configuration settings for scanner (camera + DAQ coordination)."""

    camera: CameraSettings
    daq: DAQSettings
    num_frames: int = 72
    output_path: str = "./scans"

    def __post_init__(self):
        """Validate scanner settings."""
        if self.num_frames <= 0:
            raise ValueError(f"num_frames must be positive, got {self.num_frames}")
        if not isinstance(self.camera, CameraSettings):
            raise TypeError(f"camera must be CameraSettings, got {type(self.camera)}")
        if not isinstance(self.daq, DAQSettings):
            raise TypeError(f"daq must be DAQSettings, got {type(self.daq)}")


@dataclass
class ScanProgress:
    """Progress information during a scan."""

    frame_number: int
    total_frames: int
    position: float  # Degrees
    image_path: Optional[str] = None

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "frame_number": self.frame_number,
            "total_frames": self.total_frames,
            "position": self.position,
            "image_path": self.image_path,
        }


@dataclass
class ScanResult:
    """Result of a completed scan."""

    success: bool
    frames_captured: int
    output_path: str
    error: Optional[str] = None

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "success": self.success,
            "frames_captured": self.frames_captured,
            "output_path": self.output_path,
            "error": self.error,
        }
