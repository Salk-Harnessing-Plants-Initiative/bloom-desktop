"""Tests for camera command handling in IPC handler."""

import json
import os
import pytest
from unittest.mock import Mock, patch, MagicMock
import sys
import numpy as np

# Mock hardware modules before importing ipc_handler
sys.modules['hardware.camera'] = MagicMock()
sys.modules['hardware.camera_mock'] = MagicMock()
sys.modules['hardware.camera_types'] = MagicMock()

from python.ipc_handler import handle_command


@pytest.fixture(autouse=True)
def setup_camera_mocks(monkeypatch):
    """Set up camera mocks for each test."""
    import python.ipc_handler as ipc
    
    # Create a mock camera class
    class MockCameraInstance:
        def __init__(self, settings):
            self.settings = settings
            self.is_open = False
        
        def open(self):
            self.is_open = True
            return True
        
        def close(self):
            self.is_open = False
        
        def grab_frame(self):
            # Return a simple test image
            return np.zeros((480, 640), dtype=np.uint8)
        
        def _configure_camera(self):
            pass
    
    # Create CameraSettings class
    class MockCameraSettings:
        def __init__(self, camera_ip_address, exposure_time, gain, **kwargs):
            self.camera_ip_address = camera_ip_address
            self.exposure_time = exposure_time
            self.gain = gain
            for key, value in kwargs.items():
                setattr(self, key, value)
    
    # Patch the camera modules
    monkeypatch.setattr('python.ipc_handler.CAMERA_AVAILABLE', True)
    monkeypatch.setattr('python.ipc_handler.MockCamera', MockCameraInstance)
    monkeypatch.setattr('python.ipc_handler.Camera', MockCameraInstance)
    monkeypatch.setattr('python.ipc_handler.CameraSettings', MockCameraSettings)
    
    # Reset camera instance
    ipc._camera_instance = None
    ipc._use_mock_camera = True
    
    yield
    
    # Cleanup
    ipc._camera_instance = None


@pytest.fixture
def mock_camera_settings():
    """Provide valid camera settings for testing."""
    return {
        "camera_ip_address": "10.0.0.23",
        "exposure_time": 5000,
        "gain": 10,
        "gamma": 1.0,
    }


def extract_json_data(output):
    """Helper to extract JSON data from command output."""
    lines = output.strip().split("\n")
    data_lines = [line for line in lines if line.startswith("DATA:")]
    if not data_lines:
        return None
    json_str = data_lines[0][5:].strip()
    return json.loads(json_str)


class TestCameraStatus:
    """Test camera status command."""

    def test_camera_status_not_connected(self, capsys):
        """Test status when camera is not connected."""
        handle_command({"command": "camera", "action": "status"})
        captured = capsys.readouterr()
        
        data = extract_json_data(captured.out)
        assert data is not None
        assert data["connected"] is False
        assert data["available"] is True
        assert data["mock"] is True

    def test_camera_status_connected(self, capsys, mock_camera_settings):
        """Test status when camera is connected."""
        # First connect
        handle_command({
            "command": "camera",
            "action": "connect",
            "settings": mock_camera_settings
        })
        capsys.readouterr()  # Clear output
        
        # Then check status
        handle_command({"command": "camera", "action": "status"})
        captured = capsys.readouterr()

        data = extract_json_data(captured.out)
        assert data is not None
        assert data["connected"] is True
        assert data["available"] is True


class TestCameraConnect:
    """Test camera connect command."""

    def test_connect_with_valid_settings(self, capsys, mock_camera_settings):
        """Test connecting to camera with valid settings."""
        handle_command({
            "command": "camera",
            "action": "connect",
            "settings": mock_camera_settings
        })
        captured = capsys.readouterr()

        data = extract_json_data(captured.out)
        assert data is not None
        assert data["success"] is True
        assert data["connected"] is True

    def test_connect_creates_camera_instance(self, mock_camera_settings):
        """Test that connect creates a global camera instance."""
        import python.ipc_handler as ipc

        handle_command({
            "command": "camera",
            "action": "connect",
            "settings": mock_camera_settings
        })

        assert ipc._camera_instance is not None
        assert ipc._camera_instance.is_open is True

    def test_connect_without_settings(self, capsys):
        """Test connecting without settings fails gracefully."""
        handle_command({
            "command": "camera",
            "action": "connect",
            "settings": {}
        })
        captured = capsys.readouterr()

        # Should get an error about missing required fields
        assert "ERROR:" in captured.out


class TestCameraDisconnect:
    """Test camera disconnect command."""

    def test_disconnect_when_connected(self, capsys, mock_camera_settings):
        """Test disconnecting when camera is connected."""
        # First connect
        handle_command({
            "command": "camera",
            "action": "connect",
            "settings": mock_camera_settings
        })
        capsys.readouterr()  # Clear output

        # Then disconnect
        handle_command({"command": "camera", "action": "disconnect"})
        captured = capsys.readouterr()

        data = extract_json_data(captured.out)
        assert data is not None
        assert data["success"] is True
        assert data["connected"] is False

    def test_disconnect_when_not_connected(self, capsys):
        """Test disconnecting when camera is not connected."""
        handle_command({"command": "camera", "action": "disconnect"})
        captured = capsys.readouterr()

        data = extract_json_data(captured.out)
        assert data is not None
        assert data["success"] is True
        assert data["connected"] is False

    def test_disconnect_clears_instance(self, mock_camera_settings):
        """Test that disconnect clears the global camera instance."""
        import python.ipc_handler as ipc

        # First connect
        handle_command({
            "command": "camera",
            "action": "connect",
            "settings": mock_camera_settings
        })
        assert ipc._camera_instance is not None

        # Then disconnect
        handle_command({"command": "camera", "action": "disconnect"})
        assert ipc._camera_instance is None


class TestCameraCapture:
    """Test camera capture command."""

    def test_capture_when_connected(self, capsys, mock_camera_settings):
        """Test capturing image when camera is connected."""
        # First connect
        handle_command({
            "command": "camera",
            "action": "connect",
            "settings": mock_camera_settings
        })
        capsys.readouterr()  # Clear output

        # Then capture
        handle_command({"command": "camera", "action": "capture"})
        captured = capsys.readouterr()

        data = extract_json_data(captured.out)
        assert data is not None
        assert data["success"] is True
        assert "image" in data
        assert data["image"].startswith("data:image/png;base64,")
        assert "width" in data
        assert "height" in data
        assert data["width"] > 0
        assert data["height"] > 0

    def test_capture_when_not_connected_without_settings(self, capsys):
        """Test capturing without connecting first and without settings."""
        handle_command({"command": "camera", "action": "capture"})
        captured = capsys.readouterr()

        # Should get an error
        assert "ERROR:" in captured.out
        assert "not connected" in captured.out.lower()

    def test_capture_with_settings_auto_connects(self, capsys, mock_camera_settings):
        """Test that capture with settings auto-connects."""
        handle_command({
            "command": "camera",
            "action": "capture",
            "settings": mock_camera_settings
        })
        captured = capsys.readouterr()

        data = extract_json_data(captured.out)
        assert data is not None
        assert data["success"] is True
        assert "image" in data

    def test_capture_reuses_existing_instance(self, mock_camera_settings):
        """Test that multiple captures reuse the same camera instance."""
        import python.ipc_handler as ipc

        # First connect
        handle_command({
            "command": "camera",
            "action": "connect",
            "settings": mock_camera_settings
        })
        instance_after_connect = ipc._camera_instance

        # Capture without settings
        handle_command({"command": "camera", "action": "capture"})
        instance_after_capture = ipc._camera_instance

        # Should be the same instance
        assert instance_after_connect is instance_after_capture


class TestCameraConfigure:
    """Test camera configure command."""

    def test_configure_when_connected(self, capsys, mock_camera_settings):
        """Test configuring camera when connected."""
        # First connect
        handle_command({
            "command": "camera",
            "action": "connect",
            "settings": mock_camera_settings
        })
        capsys.readouterr()  # Clear output

        # Then configure
        new_settings = {"exposure_time": 10000, "gain": 15}
        handle_command({
            "command": "camera",
            "action": "configure",
            "settings": new_settings
        })
        captured = capsys.readouterr()

        data = extract_json_data(captured.out)
        assert data is not None
        assert data["success"] is True
        assert data["configured"] is True

    def test_configure_when_not_connected(self, capsys):
        """Test configuring when camera is not connected."""
        handle_command({
            "command": "camera",
            "action": "configure",
            "settings": {"exposure_time": 10000}
        })
        captured = capsys.readouterr()

        # Should get an error
        assert "ERROR:" in captured.out
        assert "not connected" in captured.out.lower()

    def test_configure_updates_settings(self, mock_camera_settings):
        """Test that configure updates camera settings."""
        import python.ipc_handler as ipc

        # First connect
        handle_command({
            "command": "camera",
            "action": "connect",
            "settings": mock_camera_settings
        })

        original_exposure = ipc._camera_instance.settings.exposure_time
        original_gain = ipc._camera_instance.settings.gain

        # Configure with new settings
        new_settings = {"exposure_time": 15000, "gain": 20}
        handle_command({
            "command": "camera",
            "action": "configure",
            "settings": new_settings
        })

        # Settings should be updated
        assert ipc._camera_instance.settings.exposure_time == 15000
        assert ipc._camera_instance.settings.gain == 20
        assert ipc._camera_instance.settings.exposure_time != original_exposure
        assert ipc._camera_instance.settings.gain != original_gain

    def test_configure_partial_settings(self, mock_camera_settings):
        """Test that configure accepts partial settings updates."""
        import python.ipc_handler as ipc

        # First connect
        handle_command({
            "command": "camera",
            "action": "connect",
            "settings": mock_camera_settings
        })

        original_gain = ipc._camera_instance.settings.gain

        # Configure only exposure_time
        handle_command({
            "command": "camera",
            "action": "configure",
            "settings": {"exposure_time": 8000}
        })

        # Only exposure should change, gain should remain
        assert ipc._camera_instance.settings.exposure_time == 8000
        assert ipc._camera_instance.settings.gain == original_gain


class TestCameraErrorHandling:
    """Test camera error handling."""

    def test_unknown_camera_action(self, capsys):
        """Test handling unknown camera action."""
        handle_command({
            "command": "camera",
            "action": "unknown_action"
        })
        captured = capsys.readouterr()

        # Should get an error
        assert "ERROR:" in captured.out


class TestCameraWorkflow:
    """Test complete camera workflows."""

    def test_complete_workflow(self, capsys, mock_camera_settings):
        """Test complete camera workflow: connect -> capture -> configure -> capture -> disconnect."""
        # 1. Connect
        handle_command({
            "command": "camera",
            "action": "connect",
            "settings": mock_camera_settings
        })
        capsys.readouterr()

        # 2. Capture
        handle_command({"command": "camera", "action": "capture"})
        captured = capsys.readouterr()
        data = extract_json_data(captured.out)
        assert data is not None
        assert data["success"] is True

        # 3. Configure
        handle_command({
            "command": "camera",
            "action": "configure",
            "settings": {"exposure_time": 7000}
        })
        captured = capsys.readouterr()
        data = extract_json_data(captured.out)
        assert data is not None

        # 4. Capture again
        handle_command({"command": "camera", "action": "capture"})
        captured = capsys.readouterr()
        data = extract_json_data(captured.out)
        assert data is not None
        assert data["success"] is True

        # 5. Disconnect
        handle_command({"command": "camera", "action": "disconnect"})
        captured = capsys.readouterr()
        data = extract_json_data(captured.out)
        assert data is not None

    def test_status_reflects_state_changes(self, capsys, mock_camera_settings):
        """Test that status command reflects camera state changes."""
        # Initial status - not connected
        handle_command({"command": "camera", "action": "status"})
        captured = capsys.readouterr()
        data = extract_json_data(captured.out)
        assert data is not None
        assert data["connected"] is False

        # Connect
        handle_command({
            "command": "camera",
            "action": "connect",
            "settings": mock_camera_settings
        })
        capsys.readouterr()

        # Status after connect - should be connected
        handle_command({"command": "camera", "action": "status"})
        captured = capsys.readouterr()
        data = extract_json_data(captured.out)
        assert data is not None
        assert data["connected"] is True

        # Disconnect
        handle_command({"command": "camera", "action": "disconnect"})
        capsys.readouterr()

        # Status after disconnect - should be disconnected
        handle_command({"command": "camera", "action": "status"})
        captured = capsys.readouterr()
        data = extract_json_data(captured.out)
        assert data is not None
        assert data["connected"] is False
