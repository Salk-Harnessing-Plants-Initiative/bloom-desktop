"""
NI-DAQmx implementation for turntable control.

Controls stepper motor via NI-DAQ digital output for 360° plant scanning.
"""

import time
from typing import Optional
import numpy as np

try:
    from .daq_types import DAQSettings
except ImportError:
    from daq_types import DAQSettings  # type: ignore[import-not-found,no-redef]

try:
    from protocol_io import write_line  # type: ignore[import-not-found]
except ImportError:
    from python.protocol_io import write_line  # Development/test path

# Optional NI-DAQmx support
try:
    import nidaqmx
    import nidaqmx.constants

    DAQ_AVAILABLE = True
except ImportError:
    DAQ_AVAILABLE = False
    write_line("STATUS:NI-DAQmx not available, DAQ control disabled")

# Waiting for a move to finish
DAQ_WAIT_POLL_S = 0.005  # How long each wait_until_done waits
DAQ_WAIT_MARGIN_S = 5.0  # Allowed on top of how long the move should take


class DAQ:
    """NI-DAQmx controller for turntable rotation."""

    def __init__(self, settings: DAQSettings):
        """Initialize the DAQ controller.

        Args:
            settings: DAQ configuration settings
        """
        self.settings = settings
        self.task: Optional[nidaqmx.Task] = None
        self.is_initialized = False
        self.current_position = 0.0  # Current angle in degrees (0-360)
        # Degrees moved since home, unwrapped: steps are worked out from this total,
        # so rounding doesn't add up and a full set of frames is exactly one turn.
        self._moved_degrees = 0.0

    def initialize(self) -> bool:
        """Initialize the DAQ connection and create task.

        Returns:
            True if successful

        Raises:
            RuntimeError: If NI-DAQmx is not available or initialization fails
        """
        if not DAQ_AVAILABLE:
            raise RuntimeError(
                "NI-DAQmx not available. Install nidaqmx package for DAQ control."
            )

        if self.is_initialized:
            write_line("STATUS:DAQ already initialized")
            return True

        try:
            write_line("STATUS:Initializing DAQ")

            # Create NI-DAQ task
            self.task = nidaqmx.Task("bloom_daq_task")

            # Create digital output channels for stepper control
            # Line 0: Step pulses, Line 1: Direction/Enable
            lines = f"{self.settings.device_name}/port0/line{self.settings.step_pin}:{self.settings.dir_pin}"
            self.task.do_channels.add_do_chan(
                lines=lines,
                line_grouping=nidaqmx.constants.LineGrouping.CHAN_PER_LINE,
            )

            # Reserve task
            self.task.control(nidaqmx.constants.TaskMode.TASK_RESERVE)

            self.is_initialized = True
            self.current_position = 0.0
            self._moved_degrees = 0.0

            write_line("STATUS:DAQ initialized successfully")
            return True

        except Exception as e:
            if self.task:
                self.task.close()
                self.task = None
            raise RuntimeError(f"Failed to initialize DAQ: {e}")

    def rotate(self, degrees: float) -> bool:
        """Rotate the turntable by the specified degrees.

        Args:
            degrees: Degrees to rotate (positive = clockwise, negative = counter-clockwise)

        Returns:
            True if successful

        Raises:
            RuntimeError: If DAQ is not initialized
        """
        if not self.is_initialized or not self.task:
            raise RuntimeError("DAQ not initialized. Call initialize() first.")

        # Calculate rotation parameters
        steps_per_rev = self.settings.steps_per_revolution
        steps_before = round(self._moved_degrees * steps_per_rev / 360.0)
        self._moved_degrees += degrees
        steps_after = round(self._moved_degrees * steps_per_rev / 360.0)
        steps_needed = abs(steps_after - steps_before)
        direction = 1 if degrees >= 0 else -1

        write_line(f"STATUS:DAQ rotating {degrees:.2f}° ({steps_needed} steps)")

        # Execute the steps
        self.step(steps_needed, direction)

        # Update position
        self.current_position = (self.current_position + degrees) % 360.0

        write_line(
            f"STATUS:DAQ rotation complete. Position: {self.current_position:.2f}°"
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
            ValueError: If parameters are invalid
        """
        if not self.is_initialized or not self.task:
            raise RuntimeError("DAQ not initialized. Call initialize() first.")

        if direction not in (1, -1):
            raise ValueError(f"Direction must be 1 or -1, got {direction}")

        if num_steps < 0:
            raise ValueError(f"num_steps must be non-negative, got {num_steps}")

        if num_steps == 0:
            return True  # Nothing to do

        # Generate step pulses
        pulse_data = self._generate_step_pulses(num_steps, direction)

        # Execute the pulses
        self._write_and_execute(pulse_data)

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

        write_line("STATUS:DAQ homing to 0°")

        # Calculate degrees to home (always take shortest path)
        degrees_to_home = -self.current_position
        if abs(degrees_to_home) > 180:
            degrees_to_home = (360 - abs(degrees_to_home)) * (
                -1 if degrees_to_home > 0 else 1
            )

        # Rotate to home
        if abs(degrees_to_home) > 0.1:  # Only move if not already at home
            self.rotate(degrees_to_home)

        self.current_position = 0.0
        self._moved_degrees = 0.0
        write_line("STATUS:DAQ homing complete")
        return True

    def cleanup(self) -> None:
        """Clean up and close the DAQ task."""
        if not self.is_initialized:
            return

        write_line("STATUS:Cleaning up DAQ")

        if self.task:
            try:
                self.task.close()
            except Exception as e:
                write_line(f"WARNING:Error closing DAQ task: {e}")
            finally:
                self.task = None

        self.is_initialized = False
        write_line("STATUS:DAQ cleanup complete")

    def get_position(self) -> float:
        """Get current turntable position in degrees.

        Returns:
            Current position (0-360 degrees)
        """
        return self.current_position

    def _generate_step_pulses(self, num_steps: int, direction: int) -> np.ndarray:
        """Generate digital output pattern for step pulses.

        Args:
            num_steps: Number of steps to generate
            direction: Direction (1 = clockwise, -1 = counter-clockwise)

        Returns:
            2D array of digital output values [step_channel, dir_channel]
        """
        # Calculate timing: fast enough for one full turn in seconds_per_rot.
        pulse_frequency = (
            self.settings.steps_per_revolution / self.settings.seconds_per_rot
        )
        samples_per_step = int(self.settings.sampling_rate / pulse_frequency)
        half_samples = max(samples_per_step // 2, 1)

        # Generate step pulse pattern (square wave)
        samples = []
        for _ in range(num_steps):
            samples.extend([0.0] * half_samples)  # Low
            samples.extend([1.0] * half_samples)  # High

        # Convert to boolean array
        step_channel = np.array(samples) > 0.5

        # Direction channel: High for clockwise, Low for counter-clockwise
        dir_value = direction > 0
        dir_channel = np.full(len(step_channel), dir_value, dtype=bool)

        # Stack channels: [step, direction]
        data = np.vstack([step_channel, dir_channel])

        return data

    def _write_and_execute(self, data: np.ndarray) -> None:
        """Write data to DAQ and execute the task.

        Args:
            data: 2D array of digital output values

        Raises:
            RuntimeError: If DAQ task execution fails
            TimeoutError: If DAQ task times out
        """
        if not self.task:
            raise RuntimeError("DAQ task not initialized")

        try:
            # Configure timing
            self.task.timing.cfg_samp_clk_timing(
                rate=self.settings.sampling_rate,
                sample_mode=nidaqmx.constants.AcquisitionType.FINITE,
                samps_per_chan=data.shape[1],
            )

            # Write data
            self.task.write(data=data, auto_start=False)

            # Start task
            self.task.start()

            # Wait for completion, retrying on any error as the pilot app does: "not done
            # yet" arrives as an error, so a move longer than one wait always sees one.
            # How long a move takes depends on its size and speed, so the limit does too.
            limit_s = data.shape[1] / self.settings.sampling_rate + DAQ_WAIT_MARGIN_S
            deadline = time.monotonic() + limit_s
            while True:
                try:
                    self.task.wait_until_done(timeout=DAQ_WAIT_POLL_S)
                    break
                except Exception as e:
                    if time.monotonic() >= deadline:
                        raise TimeoutError(
                            f"DAQ task did not complete within {limit_s:.1f}s: {e}"
                        ) from e
                    # An error can return at once, so don't spin on it.
                    time.sleep(DAQ_WAIT_POLL_S)

            # Stop task
            self.task.stop()

        except Exception as e:
            # Make sure task is stopped on error
            if self.task:
                try:
                    self.task.stop()
                except Exception:  # noqa: S110
                    # Ignore errors during emergency stop
                    pass
            raise RuntimeError(f"DAQ execution failed: {e}")
