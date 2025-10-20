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
from typing import Any, Dict, Optional

# Import version from package
try:
    from python import __version__
except ImportError:
    __version__ = "0.1.0"

# Import camera modules
try:
    from hardware.camera import Camera
    from hardware.camera_mock import MockCamera
    from hardware.camera_types import CameraSettings

    CAMERA_AVAILABLE = True
except ImportError as e:
    # Print import error for debugging
    print(f"DEBUG: Failed to import camera modules: {e}", file=sys.stderr, flush=True)
    CAMERA_AVAILABLE = False
    Camera = None
    MockCamera = None
    CameraSettings = None


# Global camera instance
_camera_instance: Optional[Any] = None
_use_mock_camera = os.environ.get("BLOOM_USE_MOCK_CAMERA", "true").lower() == "true"


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
        stderr_fd = sys.stderr.fileno()
        with open(os.devnull, "w") as devnull:
            old_stderr = os.dup(stderr_fd)
            os.dup2(devnull.fileno(), stderr_fd)
            try:
                import pypylon.pylon as pylon
            finally:
                os.dup2(old_stderr, stderr_fd)
                os.close(old_stderr)

        hardware_status["camera"]["library_available"] = True

        # Try to enumerate cameras
        # Also suppress stderr here as TlFactory.GetInstance() can also emit errors
        try:
            stderr_fd = sys.stderr.fileno()
            with open(os.devnull, "w") as devnull:
                old_stderr = os.dup(stderr_fd)
                os.dup2(devnull.fileno(), stderr_fd)
                try:
                    tlFactory = pylon.TlFactory.GetInstance()
                    devices = tlFactory.EnumerateDevices()
                    num_cameras = len(devices)
                    hardware_status["camera"]["devices_found"] = num_cameras
                    hardware_status["camera"]["available"] = num_cameras > 0
                finally:
                    os.dup2(old_stderr, stderr_fd)
                    os.close(old_stderr)
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


def get_camera_instance(settings: Dict[str, Any]) -> Any:
    """Get or create camera instance.

    Args:
        settings: Camera settings dictionary

    Returns:
        Camera or MockCamera instance

    Raises:
        RuntimeError: If camera module is not available
    """
    global _camera_instance

    if not CAMERA_AVAILABLE:
        raise RuntimeError("Camera module not available")

    # Create settings object
    camera_settings = CameraSettings(**settings)

    # Create new camera instance if needed
    if _camera_instance is None:
        if _use_mock_camera:
            send_status("Using mock camera")
            _camera_instance = MockCamera(camera_settings)
        else:
            send_status("Using real camera")
            _camera_instance = Camera(camera_settings)
    else:
        # Update settings on existing instance
        _camera_instance.settings = camera_settings

    return _camera_instance


def close_camera() -> None:
    """Close the camera instance if it exists."""
    global _camera_instance

    if _camera_instance is not None:
        try:
            _camera_instance.close()
        except Exception as e:
            send_error(f"Error closing camera: {e}")
        finally:
            _camera_instance = None


def handle_camera_command(cmd: Dict[str, Any]) -> None:
    """Handle camera-specific commands.

    Args:
        cmd: Command dictionary with camera parameters
    """
    if not CAMERA_AVAILABLE:
        send_error("Camera module not available")
        return

    action = cmd.get("action")
    settings = cmd.get("settings", {})

    try:
        if action == "connect":
            camera = get_camera_instance(settings)
            success = camera.open()
            send_data({"success": success, "connected": True})

        elif action == "disconnect":
            close_camera()
            send_data({"success": True, "connected": False})

        elif action == "capture":
            camera = get_camera_instance(settings)
            if not camera.is_open:
                camera.open()

            # Capture single frame
            frame = camera.grab_frame()
            # Convert to base64 for transmission
            import base64
            from io import BytesIO
            from PIL import Image

            buffer = BytesIO()
            pil_img = Image.fromarray(frame)
            pil_img.save(buffer, format="PNG", compress_level=0)
            img_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")

            send_data(
                {
                    "success": True,
                    "image": f"data:image/png;base64,{img_base64}",
                    "width": frame.shape[1],
                    "height": frame.shape[0],
                }
            )

        elif action == "configure":
            # Update camera settings
            camera = get_camera_instance(settings)
            if camera.is_open:
                camera._configure_camera()
            send_data({"success": True, "configured": True})

        elif action == "status":
            # Get camera status
            is_connected = _camera_instance is not None and _camera_instance.is_open
            send_data(
                {
                    "connected": is_connected,
                    "mock": _use_mock_camera,
                    "available": CAMERA_AVAILABLE,
                }
            )

        else:
            send_error(f"Unknown camera action: {action}")

    except Exception as e:
        send_error(f"Camera command error: {e}")
        send_data({"success": False, "error": str(e)})


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

    elif command == "camera":
        handle_camera_command(cmd)

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
