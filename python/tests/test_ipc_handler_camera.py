"""
Unit tests for IPC handler camera settings filtering (fix-camera-scan-params).

TDD: Verifies that get_camera_instance() filters unknown kwargs
and casts gain to int before constructing CameraSettings.
"""


class TestIpcHandlerCameraFiltering:
    """Test IPC handler's camera settings filtering."""

    def setup_method(self):
        """Reset camera instance and ensure real classes before each test."""
        import python.ipc_handler as handler
        from python.hardware.camera_mock import MockCamera
        from python.hardware.camera_types import CameraSettings

        # Explicitly restore real classes in case monkeypatch from other tests
        # contaminated the module-level references
        handler.MockCamera = MockCamera
        handler.CameraSettings = CameraSettings
        handler.CAMERA_AVAILABLE = True
        handler._camera_instance = None
        handler._use_mock_camera = True

    def teardown_method(self):
        """Clean up camera instance after each test."""
        import python.ipc_handler as handler

        handler._camera_instance = None

    def test_1_6_1_filters_unknown_kwargs(self):
        """get_camera_instance() filters unknown kwargs like brightness, contrast."""
        import python.ipc_handler as handler

        handler._camera_instance = None
        handler._use_mock_camera = True

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
        camera = handler.get_camera_instance(settings)
        assert camera is not None
        assert camera.settings.exposure_time == 10000
        assert camera.settings.gain == 100

    def test_1_6_2_casts_gain_to_int_from_json_float(self):
        """get_camera_instance() casts gain to int when received as float."""
        import python.ipc_handler as handler

        handler._camera_instance = None
        handler._use_mock_camera = True

        settings = {
            "exposure_time": 10000,
            "gain": 100.0,  # JSON deserializes numbers as float
            "camera_ip_address": "mock",
            "gamma": 1.0,
        }

        camera = handler.get_camera_instance(settings)
        assert isinstance(camera.settings.gain, int)
        assert camera.settings.gain == 100
