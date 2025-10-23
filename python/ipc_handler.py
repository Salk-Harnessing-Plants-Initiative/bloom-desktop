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
    - FRAME:<base64_data_uri> - Streaming frame data (base64-encoded PNG)
"""

import base64
import json
import os
import sys
import threading
import time
from io import BytesIO
from typing import Any, Dict, Optional

from PIL import Image

# Import version from package
try:
    from python import __version__
except ImportError:
    __version__ = "0.1.0"

# Import camera modules
# Try both import paths for compatibility with bundled and development environments
try:
    # First try bundled app import path
    from hardware.camera import Camera  # type: ignore[import-not-found]
    from hardware.camera_mock import MockCamera  # type: ignore[import-not-found]
    from hardware.camera_types import CameraSettings  # type: ignore[import-not-found]

    CAMERA_AVAILABLE = True
except ImportError:
    try:
        # Fall back to development/test import path
        from python.hardware.camera import Camera  # type: ignore[import-not-found]
        from python.hardware.camera_mock import MockCamera  # type: ignore[import-not-found]
        from python.hardware.camera_types import CameraSettings  # type: ignore[import-not-found]

        CAMERA_AVAILABLE = True
    except ImportError as e:
        # Report import error using protocol-compliant error reporting
        # Use print directly since send_error() is defined later in this file
        print(f"ERROR:Failed to import camera modules: {e}", flush=True)
        CAMERA_AVAILABLE = False
        Camera = None
        MockCamera = None
        CameraSettings = None

# Import DAQ modules
# Try both import paths for compatibility with bundled and development environments
try:
    # First try bundled app import path
    from hardware.daq import DAQ  # type: ignore[import-not-found]
    from hardware.daq_mock import MockDAQ  # type: ignore[import-not-found]
    from hardware.daq_types import DAQSettings  # type: ignore[import-not-found]

    DAQ_AVAILABLE = True
except ImportError:
    try:
        # Fall back to development/test import path
        from python.hardware.daq import DAQ  # type: ignore[import-not-found]
        from python.hardware.daq_mock import MockDAQ  # type: ignore[import-not-found]
        from python.hardware.daq_types import DAQSettings  # type: ignore[import-not-found]

        DAQ_AVAILABLE = True
    except ImportError as e:
        print(f"ERROR:Failed to import DAQ modules: {e}", flush=True)
        DAQ_AVAILABLE = False
        DAQ = None
        MockDAQ = None
        DAQSettings = None

# Import Scanner modules
# Try both import paths for compatibility with bundled and development environments
try:
    # First try bundled app import path
    from hardware.scanner import Scanner, MockScanner  # type: ignore[import-not-found]
    from hardware.scanner_types import ScannerSettings  # type: ignore[import-not-found]

    SCANNER_AVAILABLE = True
except ImportError:
    try:
        # Fall back to development/test import path
        from python.hardware.scanner import Scanner, MockScanner  # type: ignore[import-not-found]
        from python.hardware.scanner_types import ScannerSettings  # type: ignore[import-not-found]

        SCANNER_AVAILABLE = True
    except ImportError as e:
        print(f"ERROR:Failed to import Scanner modules: {e}", flush=True)
        SCANNER_AVAILABLE = False
        Scanner = None
        MockScanner = None
        ScannerSettings = None


# Global camera instance
_camera_instance: Optional[Any] = None
_use_mock_camera = os.environ.get("BLOOM_USE_MOCK_CAMERA", "true").lower() == "true"

# Global DAQ instance
_daq_instance: Optional[Any] = None
_use_mock_daq = os.environ.get("BLOOM_USE_MOCK_DAQ", "true").lower() == "true"

# Global Scanner instance
_scanner_instance: Optional[Any] = None
_use_mock_hardware = os.environ.get("BLOOM_USE_MOCK_HARDWARE", "true").lower() == "true"

# Global streaming state
_streaming_thread: Optional[threading.Thread] = None
_streaming_active = threading.Event()
_streaming_lock = threading.Lock()


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


def send_frame(frame_data: str) -> None:
    """Send a frame to stdout for streaming.

    Args:
        frame_data: Base64-encoded image data with data URI prefix
    """
    print(f"FRAME:{frame_data}", flush=True)


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


def streaming_worker() -> None:
    """Background thread worker for camera streaming.

    Continuously captures frames from the camera and sends them via FRAME: protocol
    while _streaming_active is set. Targets ~30 FPS (33ms per frame).
    """
    target_fps = 30
    frame_interval = 1.0 / target_fps

    send_status("Streaming worker started")

    while _streaming_active.is_set():
        try:
            if _camera_instance is None or not _camera_instance.is_open:
                send_error("Camera not available during streaming")
                break

            # Capture frame using base64 method
            frame_start = time.time()
            frame_data = _camera_instance.grab_frame_base64()
            send_frame(frame_data)

            # Maintain target FPS
            elapsed = time.time() - frame_start
            sleep_time = max(0, frame_interval - elapsed)
            if sleep_time > 0:
                time.sleep(sleep_time)

        except Exception as e:
            send_error(f"Streaming error: {e}")
            break

    send_status("Streaming worker stopped")


def get_daq_instance(settings: Dict[str, Any]) -> Any:
    """Get or create DAQ instance.

    Args:
        settings: DAQ settings dictionary

    Returns:
        DAQ or MockDAQ instance

    Raises:
        RuntimeError: If DAQ module is not available
    """
    global _daq_instance

    if not DAQ_AVAILABLE:
        raise RuntimeError("DAQ module not available")

    # Create settings object
    daq_settings = DAQSettings(**settings)

    # Create new DAQ instance if needed
    if _daq_instance is None:
        if _use_mock_daq:
            send_status("Using mock DAQ")
            _daq_instance = MockDAQ(daq_settings)
        else:
            send_status("Using real DAQ")
            _daq_instance = DAQ(daq_settings)
    else:
        # Update settings on existing instance
        _daq_instance.settings = daq_settings

    return _daq_instance


def cleanup_daq() -> None:
    """Clean up the DAQ instance if it exists."""
    global _daq_instance

    if _daq_instance is not None:
        try:
            _daq_instance.cleanup()
        except Exception as e:
            send_error(f"Error cleaning up DAQ: {e}")
        finally:
            _daq_instance = None


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
            # Use existing camera if already connected, otherwise create/connect
            if _camera_instance is not None and _camera_instance.is_open:
                camera = _camera_instance
            elif settings:
                camera = get_camera_instance(settings)
                if not camera.is_open:
                    camera.open()
            else:
                raise RuntimeError(
                    "Camera not connected. Call connect() first or provide settings."
                )

            # Capture single frame
            frame = camera.grab_frame()
            # Convert to base64 for transmission
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
            # Update camera settings - only works if camera exists
            if _camera_instance is None:
                raise RuntimeError("Camera not connected. Call connect() first.")

            # Update only the provided settings
            for key, value in settings.items():
                if hasattr(_camera_instance.settings, key):
                    setattr(_camera_instance.settings, key, value)

            # Re-configure if camera is open
            if _camera_instance.is_open and hasattr(
                _camera_instance, "_configure_camera"
            ):
                _camera_instance._configure_camera()

            send_data({"success": True, "configured": True})

        elif action == "start_stream":
            # Start streaming frames in background thread
            global _streaming_thread

            with _streaming_lock:
                # Check if already streaming
                if _streaming_active.is_set():
                    send_data({"success": True, "streaming": True, "message": "Already streaming"})
                    return

                # Ensure camera is connected
                if _camera_instance is None or not _camera_instance.is_open:
                    if settings:
                        camera = get_camera_instance(settings)
                        camera.open()
                    else:
                        raise RuntimeError("Camera not connected. Call connect() first or provide settings.")

                # Start streaming thread
                _streaming_active.set()
                _streaming_thread = threading.Thread(target=streaming_worker, daemon=True)
                _streaming_thread.start()

            send_data({"success": True, "streaming": True})

        elif action == "stop_stream":
            # Stop streaming thread
            global _streaming_thread

            with _streaming_lock:
                if not _streaming_active.is_set():
                    send_data({"success": True, "streaming": False, "message": "Not streaming"})
                    return

                # Signal thread to stop
                _streaming_active.clear()

                # Wait for thread to finish (with timeout)
                if _streaming_thread is not None:
                    _streaming_thread.join(timeout=2.0)
                    _streaming_thread = None

            send_data({"success": True, "streaming": False})

        elif action == "status":
            # Get camera status
            is_connected = _camera_instance is not None and _camera_instance.is_open
            send_data(
                {
                    "success": True,
                    "connected": is_connected,
                    "mock": _use_mock_camera,
                    "available": CAMERA_AVAILABLE,
                }
            )

        else:
            send_error(f"Unknown camera action: {action}")

    except Exception as e:
        # Send error via DATA protocol for consistent response handling
        send_data({"success": False, "error": str(e)})


def handle_daq_command(cmd: Dict[str, Any]) -> None:
    """Handle DAQ-specific commands.

    Args:
        cmd: Command dictionary with DAQ parameters
    """
    if not DAQ_AVAILABLE:
        send_error("DAQ module not available")
        return

    action = cmd.get("action")
    settings = cmd.get("settings", {})

    try:
        if action == "initialize":
            daq = get_daq_instance(settings)
            success = daq.initialize()
            send_data({"success": success, "initialized": True})

        elif action == "cleanup":
            cleanup_daq()
            send_data({"success": True, "initialized": False})

        elif action == "rotate":
            # Rotate by specified degrees
            if _daq_instance is None or not _daq_instance.is_initialized:
                raise RuntimeError("DAQ not initialized. Call initialize() first.")

            degrees = cmd.get("degrees")
            if degrees is None:
                raise ValueError("degrees parameter required for rotate action")

            success = _daq_instance.rotate(degrees)
            position = _daq_instance.get_position()
            send_data({"success": success, "position": position})

        elif action == "step":
            # Execute specific number of steps
            if _daq_instance is None or not _daq_instance.is_initialized:
                raise RuntimeError("DAQ not initialized. Call initialize() first.")

            num_steps = cmd.get("num_steps")
            direction = cmd.get("direction", 1)

            if num_steps is None:
                raise ValueError("num_steps parameter required for step action")

            success = _daq_instance.step(num_steps, direction)
            position = _daq_instance.get_position()
            send_data({"success": success, "position": position})

        elif action == "home":
            # Return to zero position
            if _daq_instance is None or not _daq_instance.is_initialized:
                raise RuntimeError("DAQ not initialized. Call initialize() first.")

            success = _daq_instance.home()
            position = _daq_instance.get_position()
            send_data({"success": success, "position": position})

        elif action == "status":
            # Get DAQ status
            is_initialized = _daq_instance is not None and _daq_instance.is_initialized
            position = _daq_instance.get_position() if is_initialized else 0.0  # type: ignore[union-attr]
            send_data(
                {
                    "success": True,
                    "initialized": is_initialized,
                    "position": position,
                    "mock": _use_mock_daq,
                    "available": DAQ_AVAILABLE,
                }
            )

        else:
            send_error(f"Unknown DAQ action: {action}")

    except Exception as e:
        # Send error via DATA protocol for consistent response handling
        send_data({"success": False, "error": str(e)})


def get_scanner_instance(settings: Dict[str, Any]) -> Any:
    """Get or create scanner instance.

    Args:
        settings: Scanner settings dictionary with camera and daq settings

    Returns:
        Scanner or MockScanner instance

    Raises:
        RuntimeError: If scanner module is not available
    """
    global _scanner_instance

    if not SCANNER_AVAILABLE:
        raise RuntimeError("Scanner module not available")

    # Create settings object
    scanner_settings = ScannerSettings(**settings)

    # Create new scanner instance if needed, or if settings have changed
    if _scanner_instance is None:
        if _use_mock_hardware:
            send_status("Using mock scanner")
            _scanner_instance = MockScanner(scanner_settings)
        else:
            send_status("Using real scanner")
            _scanner_instance = Scanner(scanner_settings)
    else:
        # Check if scan is in progress
        if hasattr(_scanner_instance, "is_scanning") and _scanner_instance.is_scanning:
            raise RuntimeError("Cannot change settings during active scan")

        # If settings changed, recreate scanner instance
        if _scanner_instance.settings != scanner_settings:
            send_status("Settings changed, reinitializing scanner")
            cleanup_scanner()
            if _use_mock_hardware:
                send_status("Using mock scanner")
                _scanner_instance = MockScanner(scanner_settings)
            else:
                send_status("Using real scanner")
                _scanner_instance = Scanner(scanner_settings)
        # Else: settings unchanged, reuse existing instance

    return _scanner_instance


def cleanup_scanner() -> None:
    """Clean up the scanner instance if it exists."""
    global _scanner_instance

    if _scanner_instance is not None:
        try:
            _scanner_instance.cleanup()
        except Exception as e:
            send_error(f"Error cleaning up scanner: {e}")
        finally:
            _scanner_instance = None


def handle_scanner_command(cmd: Dict[str, Any]) -> None:
    """Handle scanner-specific commands.

    Args:
        cmd: Command dictionary with scanner parameters
    """
    if not SCANNER_AVAILABLE:
        send_error("Scanner module not available")
        return

    action = cmd.get("action")
    settings = cmd.get("settings", {})

    try:
        if action == "initialize":
            scanner = get_scanner_instance(settings)
            scanner.initialize()
            send_data({"success": True, "initialized": True})

        elif action == "cleanup":
            cleanup_scanner()
            send_data({"success": True, "initialized": False})

        elif action == "scan":
            # Perform a complete scan
            if _scanner_instance is None or not _scanner_instance.is_initialized:
                raise RuntimeError("Scanner not initialized. Call initialize() first.")

            # Perform scan (no progress callback for now)
            result = _scanner_instance.perform_scan()

            send_data(
                {
                    "success": result.success,
                    "frames_captured": result.frames_captured,
                    "output_path": result.output_path,
                    "error": result.error,
                }
            )

        elif action == "status":
            # Get scanner status
            if _scanner_instance is not None:
                status = _scanner_instance.get_status()
                send_data({"success": True, **status})
            else:
                send_data(
                    {
                        "success": True,
                        "initialized": False,
                        "camera_status": "unknown",
                        "daq_status": "unknown",
                        "position": 0.0,
                        "mock": _use_mock_hardware,
                    }
                )

        else:
            send_error(f"Unknown scanner action: {action}")

    except Exception as e:
        # Send error via DATA protocol for consistent response handling
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

    elif command == "daq":
        handle_daq_command(cmd)

    elif command == "scanner":
        handle_scanner_command(cmd)

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
