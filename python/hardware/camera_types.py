"""
Camera type definitions for Bloom hardware interface.

Defines the data structures for camera configuration and operation.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class CameraSettings:
    """Configuration settings for the Basler camera.

    Attributes:
        camera_ip_address: IP address of the camera (e.g., "10.0.0.23")
        exposure_time: Exposure time in microseconds
        gain: Camera gain value (raw)
        gamma: Gamma correction value
        num_frames: Number of frames to capture
        seconds_per_rot: Time for one complete rotation (for scanning)
        brightness: Brightness setting (optional, not supported on all cameras)
        contrast: Contrast setting (optional, not supported on all cameras)
        width: Image width in pixels (optional)
        height: Image height in pixels (optional)
    """

    camera_ip_address: str
    exposure_time: float
    gain: float
    gamma: float = 1.0
    num_frames: int = 72
    seconds_per_rot: float = 36.0
    brightness: Optional[float] = None
    contrast: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None