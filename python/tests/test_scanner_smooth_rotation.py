"""A scan keeps the turntable going: frames are saved after the turn, not between moves."""

from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest

from python.hardware import camera as camera_module
from python.hardware import scanner as scanner_module
from python.hardware.camera import Camera
from python.hardware.camera_types import CameraSettings
from python.hardware.scanner import MockScanner
from python.hardware.scanner_types import ScannerSettings

NUM_FRAMES = 4
IMAGE = np.zeros((4, 4), dtype=np.uint8)


@pytest.fixture
def scan(tmp_path, monkeypatch):
    """A mock scanner recording the order of what it does."""
    settings = ScannerSettings(
        camera={"exposure_time": 10000, "gain": 100, "gamma": 1.0},
        daq={"num_frames": NUM_FRAMES},
        num_frames=NUM_FRAMES,
        output_path=str(tmp_path),
    )
    scanner = MockScanner(settings)
    scanner.initialize()
    calls = []

    def record(name, real):
        def wrapper(*args, **kwargs):
            calls.append(name)
            return real(*args, **kwargs)

        return wrapper

    scanner.daq.rotate = record("rotate", scanner.daq.rotate)
    scanner.camera.trigger_frame = record("trigger", scanner.camera.trigger_frame)
    scanner.camera.grab_frame = lambda: IMAGE
    real_write = scanner_module.iio.imwrite
    monkeypatch.setattr(
        scanner_module.iio, "imwrite", record("save", real_write), raising=True
    )
    sleeps = []
    monkeypatch.setattr(scanner_module.time, "sleep", sleeps.append)
    scanner.calls = calls
    scanner.sleeps = sleeps
    return scanner


def test_saves_nothing_until_the_turn_is_finished(scan):
    result = scan.perform_scan()

    assert result.success is True
    expected_moves = ["rotate", "trigger"] * NUM_FRAMES
    assert scan.calls == expected_moves + ["save"] * NUM_FRAMES


def test_holds_for_the_exposure_and_no_longer(scan):
    scan.perform_scan()

    # 10 ms exposure plus the margin: no extra settling wait between moves. The mock
    # turntable's own simulated delays share the same clock, so look only for these.
    assert scan.sleeps.count(pytest.approx(0.015)) == NUM_FRAMES
    assert pytest.approx(0.05) not in scan.sleeps


def test_frames_are_named_by_their_place_in_the_scan(scan, tmp_path):
    scan.perform_scan()

    names = sorted(p.name for p in Path(tmp_path).glob("*.png"))
    assert names == ["001.png", "002.png", "003.png", "004.png"]


def test_reports_progress_for_every_frame_in_order(scan):
    seen = []

    scan.perform_scan(on_frame=lambda frame, position: seen.append(frame))

    assert seen == [0, 1, 2, 3]


def test_a_failed_frame_keeps_the_others_in_their_places(scan, tmp_path, monkeypatch):
    scan.camera.retrieve_triggered_frames = lambda n: [IMAGE, None, IMAGE, IMAGE]

    result = scan.perform_scan()

    assert result.success is False
    assert result.frames_captured == 3
    assert result.error == "Only 3/4 frames captured"
    names = sorted(p.name for p in Path(tmp_path).glob("*.png"))
    assert names == ["001.png", "003.png", "004.png"]


def test_a_failed_frame_writes_nothing_to_stderr(scan, capsys):
    # The app rejects every pending command on any stderr output, which would lose the
    # "Only N/M frames captured" result and the wait for the scanner's cleanup.
    scan.camera.retrieve_triggered_frames = lambda n: [IMAGE, None, IMAGE, IMAGE]

    scan.perform_scan()

    captured = capsys.readouterr()
    assert captured.err == ""
    assert "STATUS:Frame 2 capture failed" in captured.out
    assert "STATUS:Scan completed with errors: 3/4 frames" in captured.out


def test_a_failed_move_stops_capture_and_saves_nothing(scan, tmp_path):
    scan.camera.stop_triggered_capture = MagicMock()
    scan.daq.rotate = MagicMock(side_effect=[True, RuntimeError("Motor fault")])

    result = scan.perform_scan()

    assert result.success is False
    assert "Motor fault" in result.error
    scan.camera.stop_triggered_capture.assert_called_once()
    assert list(Path(tmp_path).glob("*.png")) == []


def test_a_failed_save_fails_the_scan(scan, monkeypatch):
    monkeypatch.setattr(
        scanner_module.iio, "imwrite", MagicMock(side_effect=OSError("Disk full"))
    )

    result = scan.perform_scan()

    assert result.success is False
    assert "Disk full" in result.error


def make_real_camera():
    camera = Camera(CameraSettings(exposure_time=10000, gain=100))
    camera.camera = MagicMock()
    camera.is_open = True
    return camera


def grab_result(succeeded=True):
    result = MagicMock()
    result.GrabSucceeded.return_value = succeeded
    result.Array = IMAGE
    return result


class TestRealCamera:
    def test_sets_up_software_triggering_with_a_buffer_for_every_frame(self):
        camera = make_real_camera()

        camera.start_triggered_capture(72)

        # The driver's default of 10 buffers would stall a 72 frame scan.
        assert camera.camera.MaxNumBuffer.Value == 72
        assert camera.camera.TriggerSelector.Value == "FrameStart"
        assert camera.camera.TriggerMode.Value == "On"
        assert camera.camera.TriggerSource.Value == "Software"
        camera.camera.StartGrabbing.assert_called_once_with(
            camera_module.pylon.GrabStrategy_OneByOne
        )

    def test_refuses_to_start_when_closed(self):
        camera = make_real_camera()
        camera.is_open = False

        with pytest.raises(RuntimeError, match="not open"):
            camera.start_triggered_capture(72)

    def test_trigger_waits_until_the_camera_is_ready(self):
        camera = make_real_camera()

        camera.trigger_frame()

        names = [c[0] for c in camera.camera.method_calls]
        assert names.index("WaitForFrameTriggerReady") < names.index(
            "ExecuteSoftwareTrigger"
        )

    def test_trigger_refuses_when_capture_has_not_started(self):
        camera = make_real_camera()
        camera.camera.IsGrabbing.return_value = False

        with pytest.raises(RuntimeError, match="not started"):
            camera.trigger_frame()

    def test_retrieve_marks_a_failed_frame_and_keeps_order(self):
        camera = make_real_camera()
        results = [grab_result(), grab_result(False), grab_result()]
        camera.camera.RetrieveResult.side_effect = results

        frames = camera.retrieve_triggered_frames(3)

        assert frames[0] is not None
        assert frames[1] is None
        assert frames[2] is not None
        for result in results:
            result.Release.assert_called_once()

    def test_retrieve_counts_frames_that_never_arrive_as_failed(self):
        camera = make_real_camera()
        camera.camera.RetrieveResult.side_effect = [grab_result(), TimeoutError("No")]

        frames = camera.retrieve_triggered_frames(3)

        assert frames[0] is not None
        assert frames[1:] == [None, None]
        assert camera.camera.RetrieveResult.call_count == 2

    def test_stop_leaves_the_camera_free_running_for_the_preview(self):
        camera = make_real_camera()
        camera.camera.IsGrabbing.return_value = True

        camera.stop_triggered_capture()

        camera.camera.StopGrabbing.assert_called_once()
        assert camera.camera.TriggerMode.Value == "Off"
