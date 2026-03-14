"""
Unit tests for camera.py _configure_camera() (fix-camera-scan-params).

TDD: Verifies GainRaw receives integer values.
Tests expected to fail until int() cast is added in implementation.
"""

from unittest.mock import MagicMock
from python.hardware.camera_types import CameraSettings


class TestConfigureCamera:
    """Test _configure_camera() GainRaw integer handling."""

    def _make_camera_with_mock(self, gain):
        """Create a Camera instance with a mock Pylon camera."""
        # Import Camera class
        from python.hardware.camera import Camera

        settings = CameraSettings(exposure_time=10000, gain=gain)
        cam = Camera(settings)

        # Replace the real camera with a mock
        mock_camera = MagicMock()
        mock_camera.ExposureTimeAbs.Value = 0
        mock_camera.GainAuto.Value = "Off"
        mock_camera.GainRaw.Value = 0
        mock_camera.GammaEnable.Value = True
        mock_camera.GammaSelector.Value = "User"
        mock_camera.Gamma.Value = 1.0
        cam.camera = mock_camera

        return cam, mock_camera

    def test_1_5_1_gain_raw_receives_int(self):
        """_configure_camera() sets GainRaw.Value to int when gain=100."""
        cam, mock_camera = self._make_camera_with_mock(gain=100)
        cam._configure_camera()
        assert mock_camera.GainRaw.Value == 100
        assert isinstance(mock_camera.GainRaw.Value, int)

    def test_1_5_2_gain_raw_casts_float_to_int(self):
        """_configure_camera() sets GainRaw.Value to int(gain) when gain is float."""
        # JSON deserialization may produce 100.0 instead of 100
        # The int() cast in _configure_camera should handle this
        cam, mock_camera = self._make_camera_with_mock(gain=100)
        # Manually set gain to float to simulate JSON deserialization edge case
        cam.settings.gain = 100.0  # type: ignore[assignment]
        cam._configure_camera()
        assert mock_camera.GainRaw.Value == 100
        assert isinstance(mock_camera.GainRaw.Value, int)
