"""A scan keeps the turntable going: frames are saved after the turn, not between moves."""

from pathlib import Path
from unittest.mock import MagicMock

import imageio.v2 as iio
import numpy as np
import pytest

from python.hardware import camera as camera_module
from python.hardware import scanner as scanner_module
from python.hardware.camera import Camera
from python.hardware.camera_types import CameraSettings, FrameNotArrivedError
from python.hardware.scanner import MockScanner
from python.hardware.scanner_types import ScannerSettings

pytestmark = pytest.mark.timeout(30)

NUM_FRAMES = 4


def frame(number):
    """An image that shows which frame it is."""
    return np.full((4, 4), number, dtype=np.uint8)


@pytest.fixture
def scan(tmp_path, monkeypatch):
    """A mock scanner recording the order of what it does, with numbered frames."""
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

    scanner.daq.rotate = record("rotate", lambda degrees: True)
    scanner.daq.home = record("home", lambda: True)
    scanner.camera.trigger_frame = record("trigger", scanner.camera.trigger_frame)
    numbers = iter(range(1, NUM_FRAMES + 1))
    scanner.camera.grab_frame = lambda: frame(next(numbers))
    real_write = scanner_module.iio.imwrite
    monkeypatch.setattr(
        scanner_module.iio, "imwrite", record("save", real_write), raising=True
    )

    def sleep(seconds):
        calls.append(("sleep", pytest.approx(seconds)))

    monkeypatch.setattr(scanner_module.time, "sleep", sleep)
    scanner.calls = calls
    return scanner


def saved_frames(folder):
    """Each saved file's name and the frame number its image shows."""
    return {
        path.name: int(iio.imread(path.as_posix())[0, 0])
        for path in sorted(Path(folder).glob("*.png"))
    }


def test_turns_then_returns_home_then_saves(scan):
    result = scan.perform_scan()

    assert result.success is True
    hold = ("sleep", 0.015)  # 10 ms exposure plus the margin, and no settling wait
    moves = ["rotate", "trigger", hold] * NUM_FRAMES
    assert scan.calls == ["home"] + moves + ["home"] + ["save"] * NUM_FRAMES


def test_each_frame_is_saved_under_its_own_number(scan, tmp_path):
    scan.perform_scan()

    assert saved_frames(tmp_path) == {
        "001.png": 1,
        "002.png": 2,
        "003.png": 3,
        "004.png": 4,
    }


def test_reports_progress_for_every_frame_in_order(scan):
    seen = []

    scan.perform_scan(on_frame=lambda number, position: seen.append(number))

    assert seen == [0, 1, 2, 3]


def test_stops_capture_after_a_good_scan(scan):
    scan.camera.stop_triggered_capture = MagicMock()

    scan.perform_scan()

    scan.camera.stop_triggered_capture.assert_called_once()


def test_a_failed_frame_keeps_the_others_in_their_places(scan, tmp_path):
    results = iter([frame(1), None, frame(3), frame(4)])
    scan.camera.retrieve_next_frame = lambda: next(results)

    result = scan.perform_scan()

    assert result.success is False
    assert result.frames_captured == 3
    assert result.error == "Only 3/4 frames captured"
    assert saved_frames(tmp_path) == {"001.png": 1, "003.png": 3, "004.png": 4}


def test_an_error_collecting_a_frame_keeps_the_others_in_their_places(scan, tmp_path):
    results = iter([frame(1), MemoryError("No\nmemory"), frame(3), frame(4)])

    def retrieve():
        result = next(results)
        if isinstance(result, Exception):
            raise result
        return result

    scan.camera.retrieve_next_frame = retrieve

    result = scan.perform_scan()

    assert result.error == "Only 3/4 frames captured"
    assert saved_frames(tmp_path) == {"001.png": 1, "003.png": 3, "004.png": 4}


def test_a_frame_that_never_arrives_saves_nothing(scan, tmp_path):
    # The driver skips the third frame, so the later ones arrive one place early and
    # only the last wait shows that something is missing.
    real_trigger = scan.camera.trigger_frame
    triggers = iter([True, True, False, True])

    def trigger():
        if next(triggers):
            real_trigger()

    scan.camera.trigger_frame = trigger

    result = scan.perform_scan()

    assert result.success is False
    assert result.frames_captured == 0
    assert saved_frames(tmp_path) == {}


def test_stops_waiting_after_the_first_frame_that_never_arrives(scan, capsys):
    scan.camera.retrieve_next_frame = MagicMock(
        side_effect=FrameNotArrivedError("Timed\nout")
    )

    result = scan.perform_scan()

    assert scan.camera.retrieve_next_frame.call_count == 1
    assert result.error == "Only 0/4 frames captured"
    assert "positions are unknown: Timed out" in capsys.readouterr().out


def test_a_failed_move_stops_capture_and_saves_nothing(scan, tmp_path):
    scan.camera.stop_triggered_capture = MagicMock()
    scan.daq.rotate = MagicMock(side_effect=[True, RuntimeError("Motor fault")])

    result = scan.perform_scan()

    assert result.success is False
    assert "Motor fault" in result.error
    scan.camera.stop_triggered_capture.assert_called_once()
    assert saved_frames(tmp_path) == {}


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
    result.Array = frame(1)
    return result


class TestRealCamera:
    def test_sets_up_software_triggering_with_a_buffer_for_every_frame(self):
        camera = make_real_camera()
        at_start = {}

        def start_grabbing(strategy):
            at_start["buffers"] = camera.camera.MaxNumBuffer.Value
            at_start["trigger"] = camera.camera.TriggerMode.Value

        camera.camera.StartGrabbing.side_effect = start_grabbing

        camera.start_triggered_capture(72)

        # Set before grabbing starts, which is when the driver takes its buffers.
        assert at_start == {"buffers": 72, "trigger": "On"}
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

    def test_collects_a_frame_and_releases_the_driver_buffer(self):
        camera = make_real_camera()
        result = grab_result()
        camera.camera.RetrieveResult.return_value = result

        assert camera.retrieve_next_frame() is not None
        result.Release.assert_called_once()

    def test_a_collected_frame_is_a_copy_of_the_driver_buffer(self):
        camera = make_real_camera()
        result = grab_result()
        camera.camera.RetrieveResult.return_value = result

        assert camera.retrieve_next_frame() is not result.Array

    def test_a_failed_frame_is_none_and_still_releases_its_buffer(self):
        camera = make_real_camera()
        result = grab_result(False)
        camera.camera.RetrieveResult.return_value = result

        assert camera.retrieve_next_frame() is None
        result.Release.assert_called_once()

    def test_a_frame_that_never_arrives_is_reported(self):
        camera = make_real_camera()
        camera.camera.RetrieveResult.side_effect = TimeoutError("No frame")

        with pytest.raises(FrameNotArrivedError, match="No frame"):
            camera.retrieve_next_frame()

    def test_stop_leaves_the_camera_free_running_for_the_preview(self):
        camera = make_real_camera()
        camera.camera.IsGrabbing.return_value = True

        camera.stop_triggered_capture()

        camera.camera.StopGrabbing.assert_called_once()
        assert camera.camera.TriggerMode.Value == "Off"
