"""
Unit tests for CameraSettings type changes (fix-camera-scan-params).

TDD: These tests are written before implementation changes.
Tests 1.4.2, 1.4.3, 1.4.4, 1.4.5, 1.4.6 expected to fail until implementation.
"""

import pytest
from python.hardware.camera_types import CameraSettings


class TestCameraSettingsTypes:
    """Test Basler acA2000-50gm type compatibility."""

    def test_1_4_1_gain_int_succeeds(self):
        """CameraSettings(gain=100) succeeds and gain is int."""
        settings = CameraSettings(exposure_time=10000, gain=100)
        assert settings.gain == 100
        assert isinstance(settings.gain, int)

    def test_1_4_2_gain_float_rejected(self):
        """CameraSettings(gain=5.5) raises TypeError or ValueError."""
        with pytest.raises((TypeError, ValueError)):
            CameraSettings(exposure_time=10000, gain=5.5)

    def test_1_4_3_gain_negative_rejected(self):
        """CameraSettings(gain=-1) raises ValueError."""
        with pytest.raises(ValueError):
            CameraSettings(exposure_time=10000, gain=-1)

    def test_1_4_4_seconds_per_rot_default_is_7(self):
        """seconds_per_rot default is 7.0 (not 36.0)."""
        settings = CameraSettings(exposure_time=10000, gain=100)
        assert settings.seconds_per_rot == 7.0

    def test_1_4_5_width_kwarg_rejected(self):
        """CameraSettings(width=640) raises TypeError (removed field)."""
        with pytest.raises(TypeError):
            CameraSettings(exposure_time=10000, gain=100, width=640)

    def test_1_4_6_brightness_kwarg_rejected(self):
        """CameraSettings(brightness=0.5) raises TypeError (removed field)."""
        with pytest.raises(TypeError):
            CameraSettings(exposure_time=10000, gain=100, brightness=0.5)
