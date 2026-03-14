"""
Camera type definitions for Bloom hardware interface.

Defines the data structures for camera configuration and operation.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class CameraSettings:
    """Configuration settings for the Basler acA2000-50gm camera.

    Attributes:
        exposure_time: Exposure time in microseconds
        gain: GainRaw integer value (36-512 for acA2000-50gm)
        camera_ip_address: IP address of the camera (e.g., "10.0.0.23"). Optional for mock camera.
        gamma: Gamma correction value
        num_frames: Number of frames to capture
        seconds_per_rot: Time for one complete rotation (for scanning)
    """

    exposure_time: float
    gain: int
    camera_ip_address: Optional[str] = None
    gamma: float = 1.0
    num_frames: int = 72
    seconds_per_rot: float = 7.0

    def __post_init__(self):
        """Validate camera settings values."""
        if self.exposure_time <= 0:
            raise ValueError(
                f"exposure_time must be positive, got {self.exposure_time}"
            )

        if not isinstance(self.gain, int):
            raise TypeError(
                f"gain must be an integer (GainRaw), got {type(self.gain).__name__}"
            )

        if self.gain < 0:
            raise ValueError(f"gain must be non-negative, got {self.gain}")

        if not (0.0 <= self.gamma <= 4.0):
            raise ValueError(f"gamma must be between 0.0 and 4.0, got {self.gamma}")

        if self.num_frames <= 0:
            raise ValueError(f"num_frames must be positive, got {self.num_frames}")

        if self.seconds_per_rot <= 0:
            raise ValueError(
                f"seconds_per_rot must be positive, got {self.seconds_per_rot}"
            )
