"""
Tests for Scanner coordination functionality.

Tests the Scanner class which coordinates Camera and DAQ for automated
cylinder scanning workflows. Uses mock hardware with real test fixtures.
"""

import glob
import os

import pytest

from python.hardware.scanner import MockScanner, Scanner
from python.hardware.scanner_types import ScanResult, ScannerSettings

# Ensure mock hardware is used
os.environ["BLOOM_USE_MOCK_HARDWARE"] = "true"


@pytest.fixture
def scanner_settings():
    """Create scanner settings for testing."""
    return {
        "camera": {
            "exposure_time": 10000,
            "gain": 0.0,
            "camera_ip_address": None,
            "gamma": 1.0,
            "num_frames": 72,
            "seconds_per_rot": 36.0,
            "width": 640,
            "height": 480,
        },
        "daq": {
            "device_name": "cDAQ1Mod1",
            "sampling_rate": 40000,
            "step_pin": 0,
            "dir_pin": 1,
            "steps_per_revolution": 6400,
            "num_frames": 72,
            "seconds_per_rot": 36.0,
        },
        "num_frames": 72,
        "output_path": "./test-scans",
    }


@pytest.fixture
def small_scan_settings():
    """Create settings for a small scan (fewer frames for speed)."""
    return {
        "camera": {
            "exposure_time": 10000,
            "gain": 0.0,
            "camera_ip_address": None,
            "gamma": 1.0,
            "num_frames": 5,
            "seconds_per_rot": 36.0,
            "width": 640,
            "height": 480,
        },
        "daq": {
            "device_name": "cDAQ1Mod1",
            "sampling_rate": 40000,
            "step_pin": 0,
            "dir_pin": 1,
            "steps_per_revolution": 6400,
            "num_frames": 5,
            "seconds_per_rot": 36.0,
        },
        "num_frames": 5,
        "output_path": "./test-scans",
    }


class TestScannerSettings:
    """Test ScannerSettings dataclass validation and conversion."""

    def test_scanner_settings_creates_from_dicts(self, scanner_settings):
        """Test that ScannerSettings converts dicts to proper types."""
        from python.hardware.camera_types import CameraSettings
        from python.hardware.daq_types import DAQSettings

        settings = ScannerSettings(**scanner_settings)

        assert isinstance(settings.camera, CameraSettings)
        assert isinstance(settings.daq, DAQSettings)
        assert settings.num_frames == 72
        assert settings.output_path == "./test-scans"

    def test_scanner_settings_validates_positive_num_frames(self, scanner_settings):
        """Test that num_frames must be positive."""
        scanner_settings["num_frames"] = 0

        with pytest.raises(ValueError, match="num_frames must be positive"):
            ScannerSettings(**scanner_settings)

        scanner_settings["num_frames"] = -10
        with pytest.raises(ValueError, match="num_frames must be positive"):
            ScannerSettings(**scanner_settings)

    def test_scanner_settings_validates_output_path(self, scanner_settings):
        """Test that output_path cannot be empty."""
        scanner_settings["output_path"] = ""

        with pytest.raises(ValueError, match="output_path cannot be empty"):
            ScannerSettings(**scanner_settings)

    def test_scanner_settings_syncs_num_frames(self, scanner_settings):
        """Test that scanner num_frames overrides camera and daq."""
        scanner_settings["num_frames"] = 36
        scanner_settings["camera"]["num_frames"] = 72
        scanner_settings["daq"]["num_frames"] = 144

        settings = ScannerSettings(**scanner_settings)

        # All should be synced to scanner's num_frames
        assert settings.num_frames == 36
        assert settings.camera.num_frames == 36
        assert settings.daq.num_frames == 36

    def test_scanner_settings_accepts_camera_dataclass(self, scanner_settings):
        """Test that ScannerSettings accepts CameraSettings objects and syncs num_frames."""
        from python.hardware.camera_types import CameraSettings
        from python.hardware.daq_types import DAQSettings

        camera_settings = CameraSettings(**scanner_settings["camera"])
        daq_settings = DAQSettings(**scanner_settings["daq"])

        settings = ScannerSettings(
            camera=camera_settings,
            daq=daq_settings,
            num_frames=36,
            output_path="./scans",
        )

        # After ScannerSettings initialization, camera and daq num_frames should be synced to 36
        assert settings.camera.num_frames == 36
        assert settings.daq.num_frames == 36
        # Other settings should match original
        assert settings.camera.exposure_time == camera_settings.exposure_time
        assert settings.daq.device_name == daq_settings.device_name


class TestScannerInitialization:
    """Test Scanner initialization with mock hardware."""

    def test_scanner_creates_uninitialized(self, scanner_settings):
        """Test that Scanner starts uninitialized."""
        settings = ScannerSettings(**scanner_settings)
        scanner = Scanner(settings)

        assert scanner.is_initialized is False
        assert scanner.camera is None
        assert scanner.daq is None
        assert scanner._use_mock is True

    def test_scanner_initialize_success(self, small_scan_settings):
        """Test successful scanner initialization."""
        settings = ScannerSettings(**small_scan_settings)
        scanner = Scanner(settings)

        scanner.initialize()

        assert scanner.is_initialized is True
        assert scanner.camera is not None
        assert scanner.daq is not None
        assert scanner.camera.is_open is True
        assert scanner.daq.is_initialized is True

        # Cleanup
        scanner.cleanup()

    def test_scanner_initialize_idempotent(self, small_scan_settings):
        """Test that initialize can be called multiple times safely."""
        settings = ScannerSettings(**small_scan_settings)
        scanner = Scanner(settings)

        scanner.initialize()
        assert scanner.is_initialized is True

        # Second call should be safe
        scanner.initialize()
        assert scanner.is_initialized is True

        scanner.cleanup()

    def test_scanner_cleanup_releases_resources(self, small_scan_settings):
        """Test that cleanup releases camera and DAQ."""
        settings = ScannerSettings(**small_scan_settings)
        scanner = Scanner(settings)

        scanner.initialize()
        assert scanner.camera is not None
        assert scanner.daq is not None

        scanner.cleanup()

        assert scanner.camera is None
        assert scanner.daq is None
        assert scanner.is_initialized is False

    def test_scanner_cleanup_without_init(self, scanner_settings):
        """Test that cleanup works even if never initialized."""
        settings = ScannerSettings(**scanner_settings)
        scanner = Scanner(settings)

        # Should not raise
        scanner.cleanup()

        assert scanner.camera is None
        assert scanner.daq is None


class TestScannerStatus:
    """Test Scanner status reporting."""

    def test_get_status_before_init(self, scanner_settings):
        """Test status before initialization."""
        settings = ScannerSettings(**scanner_settings)
        scanner = Scanner(settings)

        status = scanner.get_status()

        assert status["initialized"] is False
        assert status["camera_status"] == "unknown"
        assert status["daq_status"] == "unknown"
        assert status["position"] == 0.0
        assert status["mock"] is True

    def test_get_status_after_init(self, small_scan_settings):
        """Test status after initialization."""
        settings = ScannerSettings(**small_scan_settings)
        scanner = Scanner(settings)
        scanner.initialize()

        status = scanner.get_status()

        assert status["initialized"] is True
        assert status["camera_status"] == "connected"
        assert status["daq_status"] == "initialized"
        assert status["position"] == 0.0
        assert status["mock"] is True

        scanner.cleanup()

    def test_get_status_after_cleanup(self, small_scan_settings):
        """Test status after cleanup."""
        settings = ScannerSettings(**small_scan_settings)
        scanner = Scanner(settings)
        scanner.initialize()
        scanner.cleanup()

        status = scanner.get_status()

        assert status["initialized"] is False
        assert status["camera_status"] == "unknown"
        assert status["daq_status"] == "unknown"


class TestScannerScan:
    """Test Scanner scanning workflow."""

    def test_perform_scan_requires_initialization(self, small_scan_settings):
        """Test that scan fails if not initialized."""
        settings = ScannerSettings(**small_scan_settings)
        scanner = Scanner(settings)

        with pytest.raises(RuntimeError, match="not initialized"):
            scanner.perform_scan()

    def test_perform_scan_success(self, small_scan_settings):
        """Test successful scan with 5 frames."""
        settings = ScannerSettings(**small_scan_settings)
        scanner = Scanner(settings)
        scanner.initialize()

        result = scanner.perform_scan()

        assert result.success is True
        assert result.frames_captured == 5
        # Path is normalized by pathlib (./test-scans -> test-scans)
        assert result.output_path == "test-scans"
        assert result.error is None

        scanner.cleanup()

    def test_perform_scan_returns_to_home(self, small_scan_settings):
        """Test that scan returns turntable to home position."""
        settings = ScannerSettings(**small_scan_settings)
        scanner = Scanner(settings)
        scanner.initialize()

        initial_position = scanner.daq.get_position()

        scanner.perform_scan()

        final_position = scanner.daq.get_position()

        # Should return to home (0°)
        assert abs(final_position - initial_position) < 1.0
        assert abs(final_position) < 1.0

        scanner.cleanup()

    def test_perform_scan_with_callback(self, small_scan_settings):
        """Test scan with progress callback."""
        settings = ScannerSettings(**small_scan_settings)
        scanner = Scanner(settings)
        scanner.initialize()

        frames_reported = []
        positions_reported = []

        def on_frame(frame_idx, position):
            frames_reported.append(frame_idx)
            positions_reported.append(position)

        result = scanner.perform_scan(on_frame=on_frame)

        assert result.success is True
        assert len(frames_reported) == 5
        assert frames_reported == [0, 1, 2, 3, 4]
        assert len(positions_reported) == 5
        # Positions should increase (roughly 72° per frame for 5 frames)
        assert positions_reported[0] < positions_reported[1]

        scanner.cleanup()

    def test_perform_scan_different_frame_counts(self):
        """Test scanning with different frame counts."""
        for num_frames in [3, 6, 12]:
            settings = ScannerSettings(
                camera={
                    "exposure_time": 10000,
                    "gain": 0.0,
                    "camera_ip_address": None,
                    "gamma": 1.0,
                    "num_frames": num_frames,
                    "seconds_per_rot": 36.0,
                },
                daq={
                    "device_name": "cDAQ1Mod1",
                    "sampling_rate": 40000,
                    "step_pin": 0,
                    "dir_pin": 1,
                    "steps_per_revolution": 6400,
                    "num_frames": num_frames,
                    "seconds_per_rot": 36.0,
                },
                num_frames=num_frames,
                output_path="./test-scans",
            )

            scanner = Scanner(settings)
            scanner.initialize()

            result = scanner.perform_scan()

            assert result.success is True
            assert result.frames_captured == num_frames

            scanner.cleanup()


class TestMockScanner:
    """Test MockScanner."""

    def test_mock_scanner_always_uses_mock(self, scanner_settings):
        """Test that MockScanner forces mock hardware."""
        settings = ScannerSettings(**scanner_settings)
        scanner = MockScanner(settings)

        assert scanner._use_mock is True

    def test_mock_scanner_works_like_scanner(self, small_scan_settings):
        """Test that MockScanner behaves like Scanner."""
        settings = ScannerSettings(**small_scan_settings)
        scanner = MockScanner(settings)

        scanner.initialize()
        result = scanner.perform_scan()

        assert result.success is True
        assert result.frames_captured == 5

        scanner.cleanup()


class TestScannerEdgeCases:
    """Test scanner edge cases and error handling."""

    def test_scanner_cleanup_handles_exceptions(self, small_scan_settings):
        """Test that cleanup handles exceptions gracefully."""
        settings = ScannerSettings(**small_scan_settings)
        scanner = Scanner(settings)
        scanner.initialize()

        # Manually break camera to cause exception
        scanner.camera = None

        # Should not raise
        scanner.cleanup()

        assert scanner.is_initialized is False

    def test_scan_result_dataclass(self):
        """Test ScanResult dataclass."""
        result = ScanResult(
            success=True, frames_captured=72, output_path="./scans", error=None
        )

        assert result.success is True
        assert result.frames_captured == 72
        assert result.output_path == "./scans"
        assert result.error is None

        # Test with error
        result_with_error = ScanResult(
            success=False,
            frames_captured=50,
            output_path="./scans",
            error="Camera disconnected",
        )

        assert result_with_error.success is False
        assert result_with_error.error == "Camera disconnected"


class TestScannerImagePersistence:
    """Test that Scanner saves captured images to disk.

    These tests verify the fix for the bug where Scanner.perform_scan()
    captured frames but never saved them to disk.

    See: openspec/changes/fix-scanner-image-saving/
    """

    def test_perform_scan_creates_output_directory(self, tmp_path):
        """Test that perform_scan creates output directory if it doesn't exist."""
        output_dir = tmp_path / "new_scan_output"
        assert not output_dir.exists()

        settings = ScannerSettings(
            camera={
                "exposure_time": 10000,
                "gain": 0.0,
                "camera_ip_address": None,
                "gamma": 1.0,
                "num_frames": 3,
                "seconds_per_rot": 36.0,
            },
            daq={
                "device_name": "cDAQ1Mod1",
                "sampling_rate": 40000,
                "step_pin": 0,
                "dir_pin": 1,
                "steps_per_revolution": 6400,
                "num_frames": 3,
                "seconds_per_rot": 36.0,
            },
            num_frames=3,
            output_path=str(output_dir),
        )

        scanner = Scanner(settings)
        scanner.initialize()
        scanner.perform_scan()
        scanner.cleanup()

        assert output_dir.exists()
        assert output_dir.is_dir()

    def test_perform_scan_saves_images_to_disk(self, tmp_path):
        """Test that perform_scan saves PNG files to output directory."""
        output_dir = tmp_path / "scan_with_images"

        settings = ScannerSettings(
            camera={
                "exposure_time": 10000,
                "gain": 0.0,
                "camera_ip_address": None,
                "gamma": 1.0,
                "num_frames": 5,
                "seconds_per_rot": 36.0,
            },
            daq={
                "device_name": "cDAQ1Mod1",
                "sampling_rate": 40000,
                "step_pin": 0,
                "dir_pin": 1,
                "steps_per_revolution": 6400,
                "num_frames": 5,
                "seconds_per_rot": 36.0,
            },
            num_frames=5,
            output_path=str(output_dir),
        )

        scanner = Scanner(settings)
        scanner.initialize()
        result = scanner.perform_scan()
        scanner.cleanup()

        # Verify images were saved
        png_files = glob.glob(str(output_dir / "*.png"))
        assert len(png_files) == 5, f"Expected 5 PNG files, found {len(png_files)}"
        assert result.frames_captured == 5

    def test_perform_scan_image_filenames_are_correct(self, tmp_path):
        """Test that saved images have correct zero-padded filenames."""
        output_dir = tmp_path / "scan_filenames"

        settings = ScannerSettings(
            camera={
                "exposure_time": 10000,
                "gain": 0.0,
                "camera_ip_address": None,
                "gamma": 1.0,
                "num_frames": 3,
                "seconds_per_rot": 36.0,
            },
            daq={
                "device_name": "cDAQ1Mod1",
                "sampling_rate": 40000,
                "step_pin": 0,
                "dir_pin": 1,
                "steps_per_revolution": 6400,
                "num_frames": 3,
                "seconds_per_rot": 36.0,
            },
            num_frames=3,
            output_path=str(output_dir),
        )

        scanner = Scanner(settings)
        scanner.initialize()
        scanner.perform_scan()
        scanner.cleanup()

        # Verify filenames follow NNN.png pattern (1-indexed, pilot-compatible)
        # Reference: pilot pylon.py:62 uses f'{i + 1:03d}.png'
        expected_files = [
            output_dir / "001.png",
            output_dir / "002.png",
            output_dir / "003.png",
        ]
        for expected_file in expected_files:
            assert expected_file.exists(), f"Expected file not found: {expected_file}"

    def test_perform_scan_image_count_matches_frames_captured(self, tmp_path):
        """Test that file count equals frames_captured in result."""
        output_dir = tmp_path / "scan_count_match"

        settings = ScannerSettings(
            camera={
                "exposure_time": 10000,
                "gain": 0.0,
                "camera_ip_address": None,
                "gamma": 1.0,
                "num_frames": 7,
                "seconds_per_rot": 36.0,
            },
            daq={
                "device_name": "cDAQ1Mod1",
                "sampling_rate": 40000,
                "step_pin": 0,
                "dir_pin": 1,
                "steps_per_revolution": 6400,
                "num_frames": 7,
                "seconds_per_rot": 36.0,
            },
            num_frames=7,
            output_path=str(output_dir),
        )

        scanner = Scanner(settings)
        scanner.initialize()
        result = scanner.perform_scan()
        scanner.cleanup()

        # Verify file count matches frames_captured
        png_files = glob.glob(str(output_dir / "*.png"))
        assert len(png_files) == result.frames_captured

    def test_perform_scan_images_are_readable(self, tmp_path):
        """Test that saved images can be read back with imageio.

        This verifies cross-platform path handling works correctly.
        Images saved using Path.as_posix() should be readable on any OS.
        """
        import imageio.v2 as iio

        output_dir = tmp_path / "scan_readable"

        settings = ScannerSettings(
            camera={
                "exposure_time": 10000,
                "gain": 0.0,
                "camera_ip_address": None,
                "gamma": 1.0,
                "num_frames": 3,
                "seconds_per_rot": 36.0,
            },
            daq={
                "device_name": "cDAQ1Mod1",
                "sampling_rate": 40000,
                "step_pin": 0,
                "dir_pin": 1,
                "steps_per_revolution": 6400,
                "num_frames": 3,
                "seconds_per_rot": 36.0,
            },
            num_frames=3,
            output_path=str(output_dir),
        )

        scanner = Scanner(settings)
        scanner.initialize()
        scanner.perform_scan()
        scanner.cleanup()

        # Verify each image can be read back
        for i in range(1, 4):
            filepath = output_dir / f"{i:03d}.png"
            assert filepath.exists(), f"Image file not found: {filepath}"

            # Read image back using POSIX path (cross-platform)
            image = iio.imread(filepath.as_posix())
            assert image is not None, f"Failed to read image: {filepath}"
            assert image.shape[0] > 0 and image.shape[1] > 0, f"Invalid image dimensions: {filepath}"
