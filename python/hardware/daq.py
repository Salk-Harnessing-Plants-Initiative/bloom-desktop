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
    from daq_types import DAQSettings  # type: ignore[no-redef]

# Optional NI-DAQmx support
try:
    import nidaqmx
    import nidaqmx.constants

    DAQ_AVAILABLE = True
except ImportError:
    DAQ_AVAILABLE = False
    print("STATUS:NI-DAQmx not available, DAQ control disabled", flush=True)

# DAQ timeout configuration
DAQ_RETRY_MAX_ATTEMPTS = 1000  # Maximum retry attempts for DAQ wait_until_done
DAQ_RETRY_TIMEOUT_MS = 5  # Milliseconds per retry attempt
# Total timeout: 1000 * 5ms = 5 seconds

# NI-DAQmx error codes
DAQ_ERROR_TIMEOUT = -200563  # Wait operation timed out


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
            print("STATUS:DAQ already initialized", flush=True)
            return True

        try:
            print("STATUS:Initializing DAQ", flush=True)

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

            print("STATUS:DAQ initialized successfully", flush=True)
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
        steps_needed = int(abs(degrees) * self.settings.steps_per_revolution / 360.0)
        direction = 1 if degrees >= 0 else -1

        print(f"STATUS:DAQ rotating {degrees:.2f}° ({steps_needed} steps)", flush=True)

        # Execute the steps
        self.step(steps_needed, direction)

        # Update position
        self.current_position = (self.current_position + degrees) % 360.0

        print(
            f"STATUS:DAQ rotation complete. Position: {self.current_position:.2f}°",
            flush=True,
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

        print("STATUS:DAQ homing to 0°", flush=True)

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
        print("STATUS:DAQ homing complete", flush=True)
        return True

    def cleanup(self) -> None:
        """Clean up and close the DAQ task."""
        if not self.is_initialized:
            return

        print("STATUS:Cleaning up DAQ", flush=True)

        if self.task:
            try:
                self.task.close()
            except Exception as e:
                print(f"WARNING:Error closing DAQ task: {e}", flush=True)
            finally:
                self.task = None

        self.is_initialized = False
        print("STATUS:DAQ cleanup complete", flush=True)

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
        # Calculate timing
        # Use a fixed pulse frequency for consistent stepping
        pulse_frequency = 1000  # Hz (pulses per second)
        samples_per_step = int(self.settings.sampling_rate / pulse_frequency)
        half_samples = samples_per_step // 2

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

            # Wait for completion with timeout and retry logic
            retry_count = 0
            done = False
            while not done and retry_count < DAQ_RETRY_MAX_ATTEMPTS:
                try:
                    self.task.wait_until_done(timeout=DAQ_RETRY_TIMEOUT_MS / 1000)
                    done = True
                except nidaqmx.errors.DaqError as e:
                    # Only retry for timeout errors
                    if getattr(e, "error_code", None) == DAQ_ERROR_TIMEOUT:
                        retry_count += 1
                    else:
                        raise

            if not done:
                raise TimeoutError(
                    f"DAQ task did not complete after {DAQ_RETRY_MAX_ATTEMPTS} retries (5s timeout)"
                )

            # Stop task
            self.task.stop()

        except Exception as e:
            # Make sure task is stopped on error
            if self.task:
                try:
                    self.task.stop()
                except:
                    pass
            raise RuntimeError(f"DAQ execution failed: {e}")