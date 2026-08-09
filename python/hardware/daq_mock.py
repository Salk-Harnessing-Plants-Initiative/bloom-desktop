"""
Mock DAQ implementation for testing without hardware.

Simulates NI-DAQmx turntable control for development and testing.
"""

import time

try:
    from .daq_types import DAQSettings
except ImportError:
    from daq_types import DAQSettings  # type: ignore[import-not-found,no-redef]

try:
    from protocol_io import write_line  # type: ignore[import-not-found]
except ImportError:
    from python.protocol_io import write_line  # Development/test path


class MockDAQ:
    """Mock DAQ that simulates turntable rotation without hardware."""

    def __init__(self, settings: DAQSettings):
        """Initialize the mock DAQ.

        Args:
            settings: DAQ configuration settings
        """
        self.settings = settings
        self.is_initialized = False
        self.current_position = 0.0  # Current angle in degrees (0-360)
        self.total_steps = 0  # Total steps taken

    def initialize(self) -> bool:
        """Initialize the mock DAQ connection.

        Returns:
            True if successful
        """
        if self.is_initialized:
            write_line("STATUS:Mock DAQ already initialized")
            return True

        write_line("STATUS:Initializing mock DAQ")
        # Simulate initialization delay
        time.sleep(0.1)

        self.is_initialized = True
        self.current_position = 0.0
        self.total_steps = 0

        write_line("STATUS:Mock DAQ initialized successfully")
        return True

    def rotate(self, degrees: float) -> bool:
        """Rotate the turntable by the specified degrees.

        Args:
            degrees: Degrees to rotate (positive = clockwise, negative = counter-clockwise)

        Returns:
            True if successful

        Raises:
            RuntimeError: If DAQ is not initialized
        """
        if not self.is_initialized:
            raise RuntimeError("DAQ not initialized. Call initialize() first.")

        # Calculate rotation parameters
        steps_needed = int(abs(degrees) * self.settings.steps_per_revolution / 360.0)
        direction = 1 if degrees >= 0 else -1

        write_line(f"STATUS:Mock DAQ rotating {degrees:.2f}° ({steps_needed} steps)")

        # Simulate rotation time based on steps
        rotation_time = abs(degrees) / 360.0 * self.settings.seconds_per_rot
        time.sleep(min(rotation_time, 0.5))  # Cap simulation time at 0.5s for testing

        # Update position
        self.current_position = (self.current_position + degrees) % 360.0
        self.total_steps += steps_needed * direction

        write_line(
            f"STATUS:Mock DAQ rotation complete. Position: {self.current_position:.2f}°"
        )
        return True

    def step(self, num_steps: int, direction: int) -> bool:
        """Execute a specific number of steps.

        Args:
            num_steps: Number of steps to execute
            direction: Direction (1 = clockwise, -1 = counter-clockwise)

        Returns:
            True if successful

        Raises:
            RuntimeError: If DAQ is not initialized
            ValueError: If direction is invalid
        """
        if not self.is_initialized:
            raise RuntimeError("DAQ not initialized. Call initialize() first.")

        if direction not in (1, -1):
            raise ValueError(f"Direction must be 1 or -1, got {direction}")

        if num_steps < 0:
            raise ValueError(f"num_steps must be non-negative, got {num_steps}")

        # Calculate degrees
        degrees = (num_steps / self.settings.steps_per_revolution) * 360.0 * direction

        write_line(f"STATUS:Mock DAQ stepping {num_steps} steps")

        # Simulate step time
        step_time = num_steps / self.settings.steps_per_revolution * 0.1
        time.sleep(min(step_time, 0.5))  # Cap at 0.5s

        # Update position
        self.current_position = (self.current_position + degrees) % 360.0
        self.total_steps += num_steps * direction

        write_line(
            f"STATUS:Mock DAQ step complete. Position: {self.current_position:.2f}°"
        )
        return True

    def home(self) -> bool:
        """Return turntable to zero position.

        Returns:
            True if successful

        Raises:
            RuntimeError: If DAQ is not initialized
        """
        if not self.is_initialized:
            raise RuntimeError("DAQ not initialized. Call initialize() first.")

        write_line("STATUS:Mock DAQ homing to 0°")

        # Simulate homing time
        time.sleep(0.2)

        self.current_position = 0.0

        write_line("STATUS:Mock DAQ homing complete")
        return True

    def cleanup(self) -> None:
        """Clean up and close the mock DAQ connection."""
        if not self.is_initialized:
            return

        write_line("STATUS:Cleaning up mock DAQ")
        time.sleep(0.05)  # Simulate cleanup delay

        self.is_initialized = False
        write_line("STATUS:Mock DAQ cleanup complete")

    def get_position(self) -> float:
        """Get current turntable position in degrees.

        Returns:
            Current position (0-360 degrees)
        """
        return self.current_position
