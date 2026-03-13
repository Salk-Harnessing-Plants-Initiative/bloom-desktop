"""
Unit tests for IPC handler camera settings filtering (fix-camera-scan-params).

TDD: Verifies that get_camera_instance() filters unknown kwargs
and casts gain to int before constructing CameraSettings.
"""

from unittest.mock import patch, MagicMock
import pytest


class TestIpcHandlerCameraFiltering:
    """Test IPC handler's camera settings filtering."""

    def test_1_6_1_filters_unknown_kwargs(self):
        """get_camera_instance() filters unknown kwargs like brightness, contrast."""
        from python.ipc_handler import get_camera_instance

        # Simulate settings dict from TypeScript with removed fields still present
        settings = {
            "exposure_time": 10000,
            "gain": 100,
            "camera_ip_address": "mock",
            "gamma": 1.0,
            "brightness": 0.5,  # removed field — should be filtered
            "contrast": 1.0,  # removed field — should be filtered
            "width": 640,  # removed field — should be filtered
            "height": 480,  # removed field — should be filtered
        }

        # Should not raise TypeError for unknown kwargs
        camera = get_camera_instance(settings)
        assert camera is not None
        assert camera.settings.exposure_time == 10000
        assert camera.settings.gain == 100

    def test_1_6_2_casts_gain_to_int_from_json_float(self):
        """get_camera_instance() casts gain to int when received as float."""
        from python.ipc_handler import get_camera_instance, _camera_instance
        import python.ipc_handler as handler

        # Reset camera instance
        handler._camera_instance = None

        settings = {
            "exposure_time": 10000,
            "gain": 100.0,  # JSON deserializes numbers as float
            "camera_ip_address": "mock",
            "gamma": 1.0,
        }

        camera = get_camera_instance(settings)
        assert isinstance(camera.settings.gain, int)
        assert camera.settings.gain == 100

        # Cleanup
        handler._camera_instance = None