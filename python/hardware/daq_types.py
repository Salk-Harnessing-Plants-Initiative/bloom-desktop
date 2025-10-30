"""
DAQ type definitions for Bloom hardware interface.

Defines the data structures for DAQ configuration and operation.
"""

from dataclasses import dataclass


@dataclass
class DAQSettings:
    """Configuration settings for NI-DAQ turntable control.

    Attributes:
        device_name: NI-DAQ device name (e.g., "cDAQ1Mod1")
        sampling_rate: DAQ sampling rate in Hz (default: 40000)
        step_pin: Digital output line for stepper step signal (default: 0)
        dir_pin: Digital output line for stepper direction signal (default: 1)
        steps_per_revolution: Number of steps for full 360° rotation (default: 6400)
        num_frames: Number of frames to capture during rotation
        seconds_per_rot: Time for one complete rotation in seconds
    """

    device_name: str = "cDAQ1Mod1"
    sampling_rate: int = 40_000
    step_pin: int = 0
    dir_pin: int = 1
    steps_per_revolution: int = 6400
    num_frames: int = 72
    seconds_per_rot: float = 7.0  # Changed from 36.0 for faster scans

    def __post_init__(self):
        """Validate DAQ settings values."""
        if self.sampling_rate <= 0:
            raise ValueError(
                f"sampling_rate must be positive, got {self.sampling_rate}"
            )

        if self.steps_per_revolution <= 0:
            raise ValueError(
                f"steps_per_revolution must be positive, got {self.steps_per_revolution}"
            )

        if self.num_frames <= 0:
            raise ValueError(f"num_frames must be positive, got {self.num_frames}")

        if self.seconds_per_rot <= 0:
            raise ValueError(
                f"seconds_per_rot must be positive, got {self.seconds_per_rot}"
            )

        if self.step_pin < 0 or self.dir_pin < 0:
            raise ValueError(
                f"step_pin and dir_pin must be non-negative, got step_pin={self.step_pin}, dir_pin={self.dir_pin}"
            )

        if self.step_pin == self.dir_pin:
            raise ValueError(
                f"step_pin and dir_pin must be different, both are {self.step_pin}"
            )
