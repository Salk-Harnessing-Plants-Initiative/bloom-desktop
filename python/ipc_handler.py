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
from typing import Any, Dict

# Import version from package
try:
    from python import __version__
except ImportError:
    __version__ = "0.1.0"


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


def check_hardware() -> Dict[str, bool]:
    """Check availability of hardware dependencies.

    Returns:
        Dictionary with hardware availability status
    """
    hardware_status = {"camera": False, "daq": False}

    # Check PyPylon (camera)
    try:
        import pypylon

        hardware_status["camera"] = True
    except ImportError:
        pass

    # Check NI-DAQmx
    try:
        import nidaqmx

        hardware_status["daq"] = True
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
