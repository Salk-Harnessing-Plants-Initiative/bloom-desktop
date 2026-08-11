"""Tests for python/protocol_io.py — the shared, lock-protected stdout writer.

These tests prove the stdout-interleaving race (#316) is fixed: two threads
writing to stdout concurrently must never have their writes interleave at the
byte level, regardless of payload size. A real OS pipe only exhibits this race
under specific, hard-to-reproduce scheduling/buffer-size conditions, so these
tests use a fake stdout that deterministically pauses mid-write to force the
race window open every run, instead of relying on real timing.

Every test body runs inside `capsys.disabled()`. pytest's default fd-level
output capture on Windows was found (empirically, while developing these
tests) to starve a background thread blocked mid-write inside a monkeypatched
`sys.stdout` for several real seconds — long enough to blow through this
suite's timeouts and make the race spuriously never reproduce. This has to be
entered fresh inside each test function itself (not via a fixture that enters
it during setup and yields into the test's call phase) — pytest tracks
capture state per test phase, and a `with capsys.disabled():` block that spans
the setup→call transition does not reliably carry its effect into the call
phase, even though the Python-level `with` block is technically still open.
"""

import pathlib
import sys
import threading

import pytest

import python.protocol_io as protocol_io
import python.hardware.camera_mock as camera_mock
from python.hardware.camera_mock import MockCamera
from python.hardware.camera_types import CameraSettings


class _InterleavingStdout:
    """Fake stdout whose write() pauses mid-message for large payloads.

    Simulates a real OS pipe needing multiple write() syscalls to flush a
    large `FRAME:` line: after writing the first half of an over-threshold
    payload, it signals `gap_open` and blocks on `resume` (bounded) before
    writing the second half — deterministically opening a race window a
    concurrent writer can land in.

    Opening the window isn't enough by itself: a second writer whose path to
    write_line() does real work first (e.g. constructing a MockCamera, which
    stats the filesystem before ever printing anything) might not reach this
    object's write() until well after the paused writer would have resumed
    and finished on its own — silently turning the "race" into two writes
    that never actually overlap, regardless of whether the real lock exists.
    `write_entered` lets a test detect that the second writer has genuinely
    reached the write before releasing the first one, closing that gap.
    """

    def __init__(self, split_threshold: int = 100):
        self.split_threshold = split_threshold
        self.chunks: list[tuple[str, str]] = []  # [(thread_name, text), ...]
        self.gap_open = threading.Event()
        self.resume = threading.Event()
        # Set on every write() entry, regardless of payload size. A caller
        # blocked acquiring _stdout_lock (the "green"/fixed case) never
        # reaches this method at all, so waiting on this event is a
        # zero-cost no-op there (see wait_for_contender_or_timeout()) — it
        # only matters for detecting that an UNLOCKED second writer has
        # genuinely reached the write, which is what makes the "red"/unfixed
        # case's interleaving deterministic instead of a scheduling gamble.
        self.write_entered = threading.Event()
        self._append_lock = threading.Lock()
        self.fail_next_write = False

    def wait_for_contender_or_timeout(self, timeout: float = 0.5) -> None:
        """Give a second writer every chance to reach write() before the
        paused first writer is released, without hanging when the fix is in
        place (there, the second writer blocks on the real lock upstream and
        never reaches this fake at all, so this always times out harmlessly
        in that case — see class docstring)."""
        self.write_entered.wait(timeout=timeout)

    def write(self, text):
        self.write_entered.set()

        if self.fail_next_write:
            self.fail_next_write = False
            raise BrokenPipeError("simulated write failure")

        if len(text) > self.split_threshold:
            mid = len(text) // 2
            first, second = text[:mid], text[mid:]
            with self._append_lock:
                self.chunks.append((threading.current_thread().name, first))
            self.gap_open.set()
            self.resume.wait(timeout=2.0)
            with self._append_lock:
                self.chunks.append((threading.current_thread().name, second))
        else:
            with self._append_lock:
                self.chunks.append((threading.current_thread().name, text))
        return len(text)

    def flush(self):
        pass

    def reconstructed_lines(self):
        """Concatenate every write() call in append order and split on '\\n',
        simulating what a real byte-stream reader (e.g. Node's line parser)
        would see arrive on the pipe."""
        full_text = "".join(text for _, text in self.chunks)
        lines = full_text.split("\n")
        if lines and lines[-1] == "":
            lines = lines[:-1]
        return lines


@pytest.mark.timeout(30)
def test_concurrent_frame_and_data_do_not_interleave(capsys, monkeypatch):
    """Root-cause regression test for #316: a large FRAME: write and a
    concurrent small DATA: write must never interleave at the byte level."""
    with capsys.disabled():
        fake_stdout = _InterleavingStdout()
        monkeypatch.setattr(sys, "stdout", fake_stdout)

        large_frame = "FRAME:" + ("F" * 500)
        small_data = 'DATA:{"success":true,"streaming":true}'

        thread_a = threading.Thread(
            target=lambda: protocol_io.write_line(large_frame), name="streaming-worker"
        )
        thread_a.start()

        opened = fake_stdout.gap_open.wait(timeout=2.0)
        assert opened, "fake stdout never opened its write gap — test setup is broken"
        fake_stdout.write_entered.clear()  # drop A's own signal from the wait above

        thread_b = threading.Thread(
            target=lambda: protocol_io.write_line(small_data), name="main-thread"
        )
        thread_b.start()
        # Give B a chance to actually reach the write before releasing A.
        # Bounded and harmless either way: if the fix is in place, B blocks
        # on the real lock upstream and this always times out — see
        # _InterleavingStdout's docstring. Do NOT wait for B to finish
        # outright: once _stdout_lock exists, B blocks acquiring it for A's
        # entire paused write, so that would hang the test itself.
        fake_stdout.wait_for_contender_or_timeout()
        fake_stdout.resume.set()

        thread_a.join(timeout=5.0)
        thread_b.join(timeout=5.0)
        assert not thread_a.is_alive()
        assert not thread_b.is_alive()

        lines = fake_stdout.reconstructed_lines()
        assert len(lines) == 2, f"expected 2 clean lines, got: {lines!r}"
        assert set(lines) == {large_frame, small_data}


@pytest.mark.timeout(30)
def test_concurrent_frame_and_error_do_not_interleave(capsys, monkeypatch):
    """Same as above, pairing a large frame against a small ERROR: response —
    covers the spec's 'or send_error()' alternative."""
    with capsys.disabled():
        fake_stdout = _InterleavingStdout()
        monkeypatch.setattr(sys, "stdout", fake_stdout)

        large_frame = "FRAME:" + ("F" * 500)
        small_error = 'ERROR:{"message":"boom"}'

        thread_a = threading.Thread(
            target=lambda: protocol_io.write_line(large_frame), name="streaming-worker"
        )
        thread_a.start()

        opened = fake_stdout.gap_open.wait(timeout=2.0)
        assert opened, "fake stdout never opened its write gap — test setup is broken"
        fake_stdout.write_entered.clear()

        thread_b = threading.Thread(
            target=lambda: protocol_io.write_line(small_error), name="main-thread"
        )
        thread_b.start()
        fake_stdout.wait_for_contender_or_timeout()
        fake_stdout.resume.set()

        thread_a.join(timeout=5.0)
        thread_b.join(timeout=5.0)
        assert not thread_a.is_alive()
        assert not thread_b.is_alive()

        lines = fake_stdout.reconstructed_lines()
        assert len(lines) == 2, f"expected 2 clean lines, got: {lines!r}"
        assert set(lines) == {large_frame, small_error}


@pytest.mark.timeout(30)
def test_hardware_diagnostic_does_not_interleave_with_frame(capsys, monkeypatch):
    """The stdout lock isn't just for ipc_handler.py's four send_* helpers —
    it must also cover the hardware/*.py call sites this fix's scope was
    expanded to include (design.md: 'A hardware-module diagnostic line never
    interleaves with an in-flight frame write'). Forces MockCamera's real
    _load_test_images() warning path (routed through write_line() in
    camera_mock.py) to run as "thread B", instead of a synthetic payload."""
    with capsys.disabled():
        fake_stdout = _InterleavingStdout()
        monkeypatch.setattr(sys, "stdout", fake_stdout)
        # Force _load_test_images() down its "no test images found" branch,
        # which emits the two hardware-module diagnostic lines this fix had
        # to route through write_line().
        nonexistent_dir = pathlib.Path("nonexistent-test-images-dir-for-test")
        monkeypatch.setattr(camera_mock, "TEST_IMAGES_DIR", nonexistent_dir)

        large_frame = "FRAME:" + ("F" * 500)

        thread_a = threading.Thread(
            target=lambda: protocol_io.write_line(large_frame), name="streaming-worker"
        )
        thread_a.start()

        opened = fake_stdout.gap_open.wait(timeout=2.0)
        assert opened, "fake stdout never opened its write gap — test setup is broken"
        fake_stdout.write_entered.clear()

        settings = CameraSettings(
            exposure_time=10000,
            gain=100,
            camera_ip_address="192.168.1.100",
            num_frames=1,
        )
        thread_b = threading.Thread(
            target=lambda: MockCamera(settings), name="main-thread"
        )
        thread_b.start()
        # MockCamera(settings) does real filesystem work (checking
        # TEST_IMAGES_DIR) before ever calling write_line() — unlike the
        # other two tests, B is not "instantly" at the write, so this wait
        # is load-bearing here, not just defensive.
        fake_stdout.wait_for_contender_or_timeout()
        fake_stdout.resume.set()

        thread_a.join(timeout=5.0)
        thread_b.join(timeout=5.0)
        assert not thread_a.is_alive()
        assert not thread_b.is_alive()

        lines = fake_stdout.reconstructed_lines()
        expected_warning = (
            f"WARNING: Test images directory not found at {nonexistent_dir}"
        )
        expected_fallback = "Generating synthetic test patterns instead"
        assert len(lines) == 3, f"expected 3 clean lines, got: {lines!r}"
        assert set(lines) == {large_frame, expected_warning, expected_fallback}


@pytest.mark.timeout(30)
def test_write_line_releases_lock_on_exception(capsys, monkeypatch):
    """A failed write must not leave _stdout_lock permanently held (design.md:
    'lock releases even when the underlying write fails')."""
    with capsys.disabled():
        fake_stdout = _InterleavingStdout()
        monkeypatch.setattr(sys, "stdout", fake_stdout)
        fake_stdout.fail_next_write = True

        with pytest.raises(BrokenPipeError):
            protocol_io.write_line("DATA:{}")

        # If the lock weren't released on the exception path, this would hang.
        done = threading.Event()

        def write_again():
            protocol_io.write_line("DATA:{}")
            done.set()

        t = threading.Thread(target=write_again)
        t.start()
        t.join(timeout=2.0)
        assert done.is_set(), "write_line() did not release its lock after an exception"
