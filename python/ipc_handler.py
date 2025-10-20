#!/usr/bin/env python3
"""
IPC Handler for Bloom Hardware Interface.

Handles stdin-based JSON commands and outputs responses via stdout
using a line-based protocol for communication with the Electron main process.

Protocol:
  Input (stdin): Line-delimited JSON commands
  Output (stdout): Protocol messages with prefixes:
    - STATUS:<message> - Status updates
    - ERROR:<message> - Error messages
    - DATA:<json> - JSON data responses
"""

import json
import sys
import os
from typing import Any, Dict

# Import version from package
try:
    from python import __version__
except ImportError:
    __version__ = "0.1.0"


class SuppressStderr:
    """Context manager to temporarily suppress stderr output.

    Useful for suppressing C++ library errors that bypass Python's sys.stderr.
    This is commonly needed for libraries like pypylon that write directly to
    the stderr file descriptor when initialization fails on systems without
    full SDK support.
    """

    def __enter__(self):
        """Redirect stderr to /dev/null."""
        self.stderr_fd = sys.stderr.fileno()
        self.devnull = open(os.devnull, "w")
        self.old_stderr = os.dup(self.stderr_fd)
        os.dup2(self.devnull.fileno(), self.stderr_fd)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Restore stderr to original state."""
        os.dup2(self.old_stderr, self.stderr_fd)
        os.close(self.old_stderr)
        self.devnull.close()
        return False  # Don't suppress exceptions


def send_status(message: str) -> None:
    """Send a status message to stdout.

    Args:
        message: Status message to send
    """
    print(f"STATUS:{message}", flush=True)


def send_error(message: str) -> None:
    """Send an error message to stdout.

    Args:
        message: Error message to send
    """
    print(f"ERROR:{message}", flush=True)


def send_data(data: Dict[str, Any]) -> None:
    """Send JSON data response to stdout.

    Args:
        data: Dictionary to send as JSON
    """
    print(f"DATA:{json.dumps(data)}", flush=True)


def check_hardware() -> Dict[str, Any]:
    """Check availability of hardware dependencies and connected devices.

    Returns:
        Dictionary with hardware availability status including:
        - library_available: whether the Python library is installed
        - devices_found: number of physical devices detected
        - available: True if library is installed AND devices are found
    """
    hardware_status = {
        "camera": {"library_available": False, "devices_found": 0, "available": False},
        "daq": {"library_available": False, "devices_found": 0, "available": False},
    }

    # Check PyPylon (Basler cameras)
    try:
        # Suppress stderr during import to avoid "globbing failed" errors on systems
        # without Pylon SDK runtime libraries (common in CI environments)
        with SuppressStderr():
            import pypylon.pylon as pylon

        hardware_status["camera"]["library_available"] = True

        # Try to enumerate cameras
        # Also suppress stderr here as TlFactory.GetInstance() can also emit errors
        try:
            with SuppressStderr():
                tlFactory = pylon.TlFactory.GetInstance()
                devices = tlFactory.EnumerateDevices()
                num_cameras = len(devices)
                hardware_status["camera"]["devices_found"] = num_cameras
                hardware_status["camera"]["available"] = num_cameras > 0
        except Exception:
            # Library available but can't enumerate devices
            # This can happen if:
            # - Pylon runtime libraries not fully installed
            # - No camera hardware present
            # - Permission issues
            pass
    except Exception:
        # Catch all exceptions including ImportError and runtime errors
        # pypylon may fail to import or initialize on systems without Pylon SDK
        pass

    # Check NI-DAQmx
    try:
        import nidaqmx.system

        hardware_status["daq"]["library_available"] = True

        # Try to enumerate DAQ devices
        try:
            system = nidaqmx.system.System.local()
            devices = system.devices
            num_devices = len(devices)
            hardware_status["daq"]["devices_found"] = num_devices
            hardware_status["daq"]["available"] = num_devices > 0
        except Exception:
            # Library available but can't enumerate devices
            pass
    except ImportError:
        pass

    return hardware_status


def handle_command(cmd: Dict[str, Any]) -> None:
    """Route and handle incoming commands.

    Args:
        cmd: Command dictionary with 'command' key
    """
    command = cmd.get("command")

    if command == "ping":
        send_data({"status": "ok", "message": "pong"})

    elif command == "get_version":
        send_data({"version": __version__})

    elif command == "check_hardware":
        hardware_status = check_hardware()
        send_data(hardware_status)

    else:
        send_error(f"Unknown command: {command}")


def run_ipc_loop() -> None:
    """Main IPC loop - reads commands from stdin and processes them.

    This function runs indefinitely, reading line-delimited JSON commands
    from stdin and routing them to appropriate handlers.
    """
    send_status("IPC handler ready")

    try:
        for line in sys.stdin:
            line = line.strip()

            if not line:
                continue

            try:
                cmd = json.loads(line)
                handle_command(cmd)
            except json.JSONDecodeError as e:
                send_error(f"Invalid JSON: {e}")
            except Exception as e:
                send_error(f"Command error: {e}")

    except KeyboardInterrupt:
        send_status("Shutting down (KeyboardInterrupt)")
    except Exception as e:
        send_error(f"Fatal error: {e}")


if __name__ == "__main__":
    run_ipc_loop()
