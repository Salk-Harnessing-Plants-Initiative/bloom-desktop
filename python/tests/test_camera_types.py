"""
TDD tests for CameraSettings dataclass (fix-camera-scan-params).

Tests 1.4.1-1.4.6: Validate gain is int, seconds_per_rot default,
and removal of brightness/contrast/width/height fields.
"""

import pytest

from python.hardware.camera_types import CameraSettings


class TestCameraSettingsGainType:
    """Test that gain is validated as integer (GainRaw is IInteger on acA2000-50gm)."""

    def test_gain_int_succeeds(self):
        """1.4.1: CameraSettings(exposure_time=10000, gain=100) succeeds and gain is int."""
        settings = CameraSettings(exposure_time=10000, gain=100)
        assert settings.gain == 100
        assert isinstance(settings.gain, int)

    def test_gain_float_raises_type_error(self):
        """1.4.2: CameraSettings(exposure_time=10000, gain=5.5) raises TypeError."""
        with pytest.raises(TypeError, match="gain must be an integer"):
            CameraSettings(exposure_time=10000, gain=5.5)

    def test_gain_negative_raises_value_error(self):
        """1.4.3: CameraSettings(exposure_time=10000, gain=-1) raises ValueError."""
        with pytest.raises(ValueError, match="gain must be non-negative"):
            CameraSettings(exposure_time=10000, gain=-1)


class TestCameraSettingsDefaults:
    """Test default values after fix."""

    def test_seconds_per_rot_default_is_7(self):
        """1.4.4: seconds_per_rot default is 7.0."""
        settings = CameraSettings(exposure_time=10000, gain=100)
        assert settings.seconds_per_rot == 7.0


class TestCameraSettingsRemovedFields:
    """Test that removed fields raise TypeError (unknown kwarg)."""

    def test_width_raises_type_error(self):
        """1.4.5: CameraSettings(exposure_time=10000, gain=100, width=640) raises TypeError."""
        with pytest.raises(TypeError):
            CameraSettings(exposure_time=10000, gain=100, width=640)

    def test_brightness_raises_type_error(self):
        """1.4.6: CameraSettings(exposure_time=10000, gain=100, brightness=0.5) raises TypeError."""
        with pytest.raises(TypeError):
            CameraSettings(exposure_time=10000, gain=100, brightness=0.5)
