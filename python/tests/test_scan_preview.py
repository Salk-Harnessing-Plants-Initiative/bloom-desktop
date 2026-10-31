"""The page sees each frame during a scan, without that touching the scan or its images."""

import base64
import sys
import threading
from io import BytesIO
from pathlib import Path

import imageio.v2 as iio
import numpy as np
from PIL import Image
import pytest

from python.hardware import scanner as scanner_module
from python.hardware.scan_preview import PREVIEW_MAX_SIZE_PX, frame_preview_data_uri
from python.hardware.scanner import COLLECTOR_THREAD_NAME, MockScanner
from python.hardware.scanner_types import ScannerSettings
from python.protocol_io import write_line

pytestmark = pytest.mark.timeout(30)

NUM_FRAMES = 4
FULL_SIZE = (np.arange(1088 * 2048).reshape(1088, 2048) % 256).astype(np.uint8)


def decode(data_uri):
    prefix = "data:image/jpeg;base64,"
    assert data_uri.startswith(prefix)
    return Image.open(BytesIO(base64.b64decode(data_uri[len(prefix) :])))


@pytest.fixture
def scanner(tmp_path):
    settings = ScannerSettings(
        camera={"exposure_time": 1000, "gain": 100, "gamma": 1.0},
        daq={"num_frames": NUM_FRAMES},
        num_frames=NUM_FRAMES,
        output_path=str(tmp_path),
    )
    made = MockScanner(settings)
    made.initialize()
    made.camera.grab_frame = lambda: FULL_SIZE.copy()
    made.daq.rotate = lambda degrees: True
    return made


def test_the_picture_is_a_small_jpeg_of_the_frame():
    before = FULL_SIZE.copy()

    picture = decode(frame_preview_data_uri(FULL_SIZE))

    assert picture.format == "JPEG"
    assert picture.width <= PREVIEW_MAX_SIZE_PX[0]
    assert picture.height <= PREVIEW_MAX_SIZE_PX[1]
    assert np.array_equal(FULL_SIZE, before)


def test_sends_a_picture_of_every_frame_from_a_background_thread(scanner):
    pictures = []
    threads = []

    def on_preview(data_uri):
        pictures.append(data_uri)
        threads.append(threading.current_thread())

    result = scanner.perform_scan(on_preview=on_preview)

    assert result.success is True
    assert len(pictures) == NUM_FRAMES
    assert all(t is not threading.main_thread() for t in threads)


def test_saved_images_stay_full_size(scanner, tmp_path):
    scanner.perform_scan(on_preview=lambda data_uri: None)

    saved = iio.imread((Path(tmp_path) / "001.png").as_posix())
    assert np.array_equal(saved, FULL_SIZE)


def test_a_preview_failure_does_not_fail_the_scan(scanner, capsys):
    def on_preview(data_uri):
        raise RuntimeError("Pipe\nbroken")

    result = scanner.perform_scan(on_preview=on_preview)

    assert result.success is True
    assert result.frames_captured == NUM_FRAMES
    assert "Couldn't send a scan preview: Pipe broken" in capsys.readouterr().out


def test_a_slow_preview_does_not_hold_up_the_moves(scanner):
    release = threading.Event()
    finished = []
    finished_by_last_frame = []

    def on_preview(data_uri):
        release.wait(5)
        finished.append(data_uri)

    def on_frame(frame_idx, position):
        if frame_idx == NUM_FRAMES - 1:
            finished_by_last_frame.append(len(finished))
            release.set()

    result = scanner.perform_scan(on_frame=on_frame, on_preview=on_preview)

    assert result.success is True
    assert finished_by_last_frame == [0]
    assert len(finished) == NUM_FRAMES


class StuckStdout:
    """A reader that stops reading when told to, until released."""

    def __init__(self):
        self.stuck = False
        self.release = threading.Event()
        self.lines = []

    def write(self, text):
        if self.stuck:
            self.release.wait(10)
        self.lines.append(text)

    def flush(self):
        pass


def test_a_stuck_reader_does_not_hold_up_the_moves(scanner, monkeypatch):
    # As if the app stops reading its output once the turn has started.
    stdout = StuckStdout()
    written_at_start = []
    written_by_last_frame = []

    def rotate(degrees):
        if not stdout.stuck:
            stdout.stuck = True
            written_at_start.append(len(stdout.lines))
        return True

    def on_frame(frame_idx, position):
        write_line(f"PROGRESS:{frame_idx}")
        if frame_idx == NUM_FRAMES - 1:
            written_by_last_frame.append(len(stdout.lines))
            stdout.release.set()

    scanner.daq.rotate = rotate
    monkeypatch.setattr(sys, "stdout", stdout)
    result = scanner.perform_scan(on_frame=on_frame)
    monkeypatch.undo()

    assert result.success is True
    # Every move and frame finished with nothing more written.
    assert written_by_last_frame == written_at_start
    # Nothing is lost, and order is kept, once the reader catches up.
    written = "".join(stdout.lines)
    positions = [written.index(f"PROGRESS:{n}") for n in range(NUM_FRAMES)]
    assert positions == sorted(positions)


def test_skips_pictures_when_output_is_backed_up(scanner, monkeypatch):
    monkeypatch.setattr(scanner_module, "writes_backed_up", lambda: True)
    pictures = []

    result = scanner.perform_scan(on_preview=pictures.append)

    assert pictures == []
    assert result.frames_captured == NUM_FRAMES


def test_no_failed_frame_picture_is_sent(scanner):
    results = iter([FULL_SIZE, None, FULL_SIZE, FULL_SIZE])
    scanner.camera.retrieve_next_frame = lambda: next(results)
    pictures = []

    result = scanner.perform_scan(on_preview=pictures.append)

    assert len(pictures) == 3
    assert result.frames_captured == 3


def test_a_failed_move_still_ends_the_background_thread(scanner):
    def fail(degrees):
        raise RuntimeError("Motor fault")

    scanner.daq.rotate = fail

    result = scanner.perform_scan(on_preview=lambda data_uri: None)

    assert result.success is False
    assert COLLECTOR_THREAD_NAME not in [t.name for t in threading.enumerate()]
