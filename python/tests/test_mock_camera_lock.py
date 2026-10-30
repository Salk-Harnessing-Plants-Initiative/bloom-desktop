"""The mock camera can behave like a real one, which one process can open at a time."""

import subprocess
import sys

import pytest

from python.hardware.camera_mock import MockCamera
from python.hardware.camera_types import CameraSettings

HOLD_THE_CAMERA = """
import sys
from python.hardware.camera_mock import MockCamera
from python.hardware.camera_types import CameraSettings
camera = MockCamera(CameraSettings(exposure_time=10000, gain=100))
camera.open()
print("held", flush=True)
sys.stdin.read()
"""


def new_camera() -> MockCamera:
    return MockCamera(CameraSettings(exposure_time=10000, gain=100))


@pytest.fixture
def lock_path(tmp_path, monkeypatch):
    path = tmp_path / "camera.lock"
    monkeypatch.setenv("BLOOM_MOCK_CAMERA_LOCK", str(path))
    return path


def hold_in_another_process():
    process = subprocess.Popen(
        [sys.executable, "-c", HOLD_THE_CAMERA],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    while process.stdout.readline().strip() != "held":
        assert process.poll() is None, "The holding process ended early"
    return process


def test_refuses_while_another_process_holds_it(lock_path):
    holder = hold_in_another_process()
    try:
        with pytest.raises(RuntimeError, match="another application"):
            new_camera().open()
    finally:
        holder.kill()
        holder.communicate()


def test_opens_once_the_other_process_has_gone(lock_path):
    holder = hold_in_another_process()
    holder.kill()
    holder.communicate()

    camera = new_camera()
    assert camera.open() is True
    camera.close()


def test_closing_frees_it(lock_path):
    first = new_camera()
    first.open()
    first.close()

    second = new_camera()
    assert second.open() is True
    second.close()


def test_opening_twice_in_one_process_is_fine(lock_path):
    camera = new_camera()
    camera.open()
    assert camera.open() is True
    camera.close()


def test_no_limit_without_the_setting(monkeypatch):
    monkeypatch.delenv("BLOOM_MOCK_CAMERA_LOCK", raising=False)
    first, second = new_camera(), new_camera()
    assert first.open() is True
    assert second.open() is True
    first.close()
    second.close()
