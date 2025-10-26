"""Tests for camera streaming functionality.

Tests the grab_frame_base64() methods and streaming IPC actions
to verify the camera streaming feature works correctly.
"""

import base64
import json
import time
from io import BytesIO

import pytest
from PIL import Image

from python.hardware.camera_mock import MockCamera
from python.hardware.camera_types import CameraSettings


def parse_data_response(captured_output: str) -> dict:
    """Parse DATA: response from captured stdout.

    Args:
        captured_output: Captured stdout string

    Returns:
        Parsed JSON dictionary from DATA: line
    """
    for line in captured_output.split("\n"):
        if line.startswith("DATA:"):
            json_str = line.split("DATA:", 1)[1].strip()
            return json.loads(json_str)
    raise ValueError("No DATA: line found in output")


class TestGrabFrameBase64:
    """Test base64 frame encoding for Camera and MockCamera."""

    def test_mock_camera_grab_frame_base64_returns_data_uri(self):
        """Verify MockCamera.grab_frame_base64() returns valid data URI."""
        settings = CameraSettings(
            exposure_time=10000,
            gain=0.0,
            camera_ip_address="192.168.1.100",
            num_frames=1,
        )
        camera = MockCamera(settings)
        camera.open()

        result = camera.grab_frame_base64()

        # Should be a string
        assert isinstance(result, str)

        # Should start with data URI prefix
        assert result.startswith("data:image/png;base64,")

        # Should have base64 data after prefix
        base64_part = result.split(",", 1)[1]
        assert len(base64_part) > 0

        # Base64 part should be valid base64
        try:
            decoded = base64.b64decode(base64_part)
            assert len(decoded) > 0
        except Exception as e:
            pytest.fail(f"Invalid base64 data: {e}")

    def test_mock_camera_base64_is_valid_png(self):
        """Verify MockCamera base64 can be decoded back to PNG image."""
        settings = CameraSettings(
            exposure_time=10000,
            gain=0.0,
            camera_ip_address="192.168.1.100",
            num_frames=1,
        )
        camera = MockCamera(settings)
        camera.open()

        result = camera.grab_frame_base64()
        base64_part = result.split(",", 1)[1]
        decoded = base64.b64decode(base64_part)

        # Should be able to open as PNG
        try:
            img = Image.open(BytesIO(decoded))
            assert img.format == "PNG"
            assert img.size[0] > 0  # Width
            assert img.size[1] > 0  # Height
        except Exception as e:
            pytest.fail(f"Cannot decode as PNG: {e}")

    def test_base64_output_format(self):
        """Verify output format matches: 'data:image/png;base64,{data}'."""
        settings = CameraSettings(
            exposure_time=10000,
            gain=0.0,
            camera_ip_address="192.168.1.100",
            num_frames=1,
        )
        camera = MockCamera(settings)
        camera.open()

        result = camera.grab_frame_base64()

        # Exact format check
        assert result.startswith("data:image/png;base64,")
        parts = result.split(",")
        assert len(parts) == 2
        assert parts[0] == "data:image/png;base64"

    def test_grab_frame_base64_requires_open_camera(self):
        """Verify grab_frame_base64() raises error if camera not open."""
        settings = CameraSettings(
            exposure_time=10000,
            gain=0.0,
            camera_ip_address="192.168.1.100",
            num_frames=1,
        )
        camera = MockCamera(settings)
        # Don't open camera

        with pytest.raises(RuntimeError, match="Camera is not open"):
            camera.grab_frame_base64()


class TestStreamingIPCActions:
    """Test start_stream and stop_stream IPC actions."""

    @pytest.fixture(autouse=True)
    def setup_ipc_handler(self, monkeypatch, capsys):
        """Set up IPC handler with mocked camera for each test."""
        import python.ipc_handler as ipc

        # Reset global state
        ipc._camera_instance = None
        ipc._streaming_thread = None
        ipc._streaming_active.clear()

        # Ensure we use mock camera
        monkeypatch.setenv("BLOOM_USE_MOCK_CAMERA", "true")

        # Capture stdout for protocol message verification
        self.capsys = capsys
        self.ipc = ipc

        yield

        # Cleanup: stop any running streams
        if ipc._streaming_active.is_set():
            ipc._streaming_active.clear()
            if ipc._streaming_thread is not None:
                ipc._streaming_thread.join(timeout=2.0)
        ipc._camera_instance = None
        ipc._streaming_thread = None

    def test_start_stream_with_settings(self):
        """Verify start_stream accepts camera settings and starts streaming."""
        from python.ipc_handler import handle_command

        command = {
            "command": "camera",
            "action": "start_stream",
            "settings": {
                "exposure_time": 10000,
                "gain": 0.0,
                "camera_ip_address": "192.168.1.100",
                "num_frames": 1,
            },
        }

        handle_command(command)
        captured = self.capsys.readouterr()

        # Should send success response
        data = parse_data_response(captured.out)
        assert data["success"] is True
        assert data["streaming"] is True

        # Thread should be running
        assert self.ipc._streaming_thread is not None
        assert self.ipc._streaming_thread.is_alive()
        assert self.ipc._streaming_active.is_set()

    def test_start_stream_starts_thread(self):
        """Verify start_stream creates and starts worker thread."""
        from python.ipc_handler import handle_command

        # First connect camera
        connect_cmd = {
            "command": "camera",
            "action": "connect",
            "settings": {
                "exposure_time": 10000,
                "gain": 0.0,
                "camera_ip_address": "192.168.1.100",
                "num_frames": 1,
            },
        }
        handle_command(connect_cmd)
        self.capsys.readouterr()  # Clear output

        # Start streaming
        stream_cmd = {"command": "camera", "action": "start_stream", "settings": {}}
        handle_command(stream_cmd)

        # Thread should be created and running
        assert self.ipc._streaming_thread is not None
        assert self.ipc._streaming_thread.is_alive()
        assert self.ipc._streaming_active.is_set()

    def test_start_stream_sends_frames(self):
        """Verify start_stream actually sends FRAME: messages."""
        from python.ipc_handler import handle_command

        command = {
            "command": "camera",
            "action": "start_stream",
            "settings": {
                "exposure_time": 10000,
                "gain": 0.0,
                "camera_ip_address": "192.168.1.100",
                "num_frames": 1,
            },
        }

        handle_command(command)
        self.capsys.readouterr()  # Clear startup messages

        # Wait for frames to be sent (should get ~10 frames in 0.5s at 30 FPS)
        time.sleep(0.5)
        captured = self.capsys.readouterr()

        # Should see FRAME: protocol messages
        assert "FRAME:" in captured.out
        # Should have multiple frames
        frame_count = captured.out.count("FRAME:")
        assert frame_count >= 5, f"Expected at least 5 frames, got {frame_count}"

    def test_stop_stream_stops_thread(self):
        """Verify stop_stream signals worker to exit."""
        from python.ipc_handler import handle_command

        # Start streaming
        start_cmd = {
            "command": "camera",
            "action": "start_stream",
            "settings": {
                "exposure_time": 10000,
                "gain": 0.0,
                "camera_ip_address": "192.168.1.100",
                "num_frames": 1,
            },
        }
        handle_command(start_cmd)
        self.capsys.readouterr()

        # Verify streaming is active
        assert self.ipc._streaming_active.is_set()

        # Stop streaming
        stop_cmd = {"command": "camera", "action": "stop_stream"}
        handle_command(stop_cmd)
        captured = self.capsys.readouterr()

        # Should send success response
        data = parse_data_response(captured.out)
        assert data["success"] is True
        assert data["streaming"] is False

        # Thread should be stopped
        assert not self.ipc._streaming_active.is_set()
        assert self.ipc._streaming_thread is None

    def test_stop_stream_when_not_streaming(self):
        """Verify stop_stream returns success even if not streaming."""
        from python.ipc_handler import handle_command

        command = {"command": "camera", "action": "stop_stream"}
        handle_command(command)
        captured = self.capsys.readouterr()

        # Should still return success
        data = parse_data_response(captured.out)
        assert data["success"] is True

    def test_start_stream_idempotent(self):
        """Verify calling start_stream twice returns success both times."""
        from python.ipc_handler import handle_command

        command = {
            "command": "camera",
            "action": "start_stream",
            "settings": {
                "exposure_time": 10000,
                "gain": 0.0,
                "camera_ip_address": "192.168.1.100",
                "num_frames": 1,
            },
        }

        # First call
        handle_command(command)
        captured = self.capsys.readouterr()
        data = parse_data_response(captured.out)
        assert data["success"] is True

        # Second call - should return success with "already streaming" message
        handle_command(command)
        captured = self.capsys.readouterr()
        data = parse_data_response(captured.out)
        assert data["success"] is True


class TestStreamingWorkflow:
    """Test complete streaming workflows."""

    @pytest.fixture(autouse=True)
    def setup_ipc_handler(self, monkeypatch, capsys):
        """Set up IPC handler for each test."""
        import python.ipc_handler as ipc

        # Reset global state
        ipc._camera_instance = None
        ipc._streaming_thread = None
        ipc._streaming_active.clear()

        monkeypatch.setenv("BLOOM_USE_MOCK_CAMERA", "true")

        self.capsys = capsys
        self.ipc = ipc

        yield

        # Cleanup
        if ipc._streaming_active.is_set():
            ipc._streaming_active.clear()
            if ipc._streaming_thread is not None:
                ipc._streaming_thread.join(timeout=2.0)
        ipc._camera_instance = None
        ipc._streaming_thread = None

    def test_start_stream_stop_stream_lifecycle(self):
        """Verify complete start → frames → stop workflow."""
        from python.ipc_handler import handle_command

        # Start streaming
        start_cmd = {
            "command": "camera",
            "action": "start_stream",
            "settings": {
                "exposure_time": 10000,
                "gain": 0.0,
                "camera_ip_address": "192.168.1.100",
                "num_frames": 1,
            },
        }
        handle_command(start_cmd)
        self.capsys.readouterr()  # Clear startup messages

        # Wait for frames
        time.sleep(1.0)  # Should get ~30 frames
        captured = self.capsys.readouterr()
        frame_count = captured.out.count("FRAME:")
        assert frame_count >= 20, f"Expected at least 20 frames, got {frame_count}"

        # Stop streaming
        stop_cmd = {"command": "camera", "action": "stop_stream"}
        handle_command(stop_cmd)
        self.capsys.readouterr()

        # Wait a bit to ensure no more frames
        time.sleep(0.3)
        captured = self.capsys.readouterr()

        # Should have no FRAME: messages after stopping
        assert "FRAME:" not in captured.out

    def test_multiple_start_stop_cycles(self):
        """Verify streaming can be started and stopped multiple times."""
        from python.ipc_handler import handle_command

        command = {
            "command": "camera",
            "action": "start_stream",
            "settings": {
                "exposure_time": 10000,
                "gain": 0.0,
                "camera_ip_address": "192.168.1.100",
                "num_frames": 1,
            },
        }

        for cycle in range(3):
            # Start streaming
            handle_command(command)
            self.capsys.readouterr()

            # Wait for frames
            time.sleep(0.3)
            captured = self.capsys.readouterr()
            assert (
                "FRAME:" in captured.out
            ), f"Cycle {cycle}: No frames during streaming"

            # Stop streaming
            handle_command({"command": "camera", "action": "stop_stream"})
            self.capsys.readouterr()

            # Verify stopped
            time.sleep(0.2)
            captured = self.capsys.readouterr()
            assert "FRAME:" not in captured.out, f"Cycle {cycle}: Frames after stopping"
