"""The page sees each frame during a scan, without that touching the scan or its images."""

import base64
import threading
from io import BytesIO
from pathlib import Path

import imageio.v2 as iio
import numpy as np
from PIL import Image
import pytest

from python.hardware.scan_preview import PREVIEW_MAX_SIZE_PX, frame_preview_data_uri
from python.hardware.scanner import MockScanner
from python.hardware.scanner_types import ScannerSettings

NUM_FRAMES = 4
FULL_SIZE = np.arange(1088 * 2048, dtype=np.uint32).reshape(1088, 2048) % 256
FULL_SIZE = FULL_SIZE.astype(np.uint8)


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


def test_a_preview_failure_does_not_fail_the_scan(scanner):
    def on_preview(data_uri):
        raise RuntimeError("Pipe\nbroken")

    result = scanner.perform_scan(on_preview=on_preview)

    assert result.success is True
    assert result.frames_captured == NUM_FRAMES


def test_a_slow_preview_does_not_hold_up_the_moves(scanner):
    release = threading.Event()
    triggers = []
    real_trigger = scanner.camera.trigger_frame

    def trigger():
        triggers.append(1)
        real_trigger()

    scanner.camera.trigger_frame = trigger

    def on_frame(frame_idx, position):
        if frame_idx == NUM_FRAMES - 1:
            # Every frame was taken while the first picture was still being sent.
            assert len(triggers) == NUM_FRAMES
            release.set()

    result = scanner.perform_scan(
        on_frame=on_frame, on_preview=lambda data_uri: release.wait(5)
    )

    assert result.success is True


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
    before = threading.active_count()

    result = scanner.perform_scan(on_preview=lambda data_uri: None)

    assert result.success is False
    assert threading.active_count() == before
