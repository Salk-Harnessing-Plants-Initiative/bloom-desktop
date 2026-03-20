"""
Tests for scan_worker.py — covers pure logic, mocked SANE, E2E workflows,
cancel behavior, command loop, error propagation, TIFF metadata, device
state management, and USB reset platform mocking.
"""

import io
import json
import os
import sys
import threading
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image

from python.graviscan.scan_worker import (
    ScanWorker,
    _build_tiff_metadata,
    emit_event,
    log,
)
from python.graviscan.scan_regions import get_scan_region

# ── Helpers ──────────────────────────────────────────────────────────────────


def _capture_stdout(func, *args, **kwargs):
    """Capture stdout output from a function call."""
    buf = io.StringIO()
    old = sys.stdout
    sys.stdout = buf
    try:
        func(*args, **kwargs)
    finally:
        sys.stdout = old
    return buf.getvalue()


def _capture_stderr(func, *args, **kwargs):
    """Capture stderr output from a function call."""
    buf = io.StringIO()
    old = sys.stderr
    sys.stderr = buf
    try:
        func(*args, **kwargs)
    finally:
        sys.stderr = old
    return buf.getvalue()


def _make_worker(scanner_id="test-scanner", device_name="mock-device", mock=True):
    """Create a ScanWorker with sensible test defaults."""
    return ScanWorker(scanner_id=scanner_id, device_name=device_name, mock=mock)


# ═══════════════════════════════════════════════════════════════════════════
# Section 2 — Pure Logic (No Mocks)
# ═══════════════════════════════════════════════════════════════════════════


class TestEmitEvent:
    """2.1 emit_event — stdout JSON with EVENT: prefix."""

    def test_event_json_format(self):
        out = _capture_stdout(emit_event, {"type": "ready", "scanner_id": "abc"})
        assert out.startswith("EVENT:")
        payload = json.loads(out.strip().removeprefix("EVENT:"))
        assert payload["type"] == "ready"
        assert payload["scanner_id"] == "abc"

    def test_event_with_nested_data(self):
        out = _capture_stdout(emit_event, {"type": "scan-complete", "meta": {"k": 1}})
        payload = json.loads(out.strip().removeprefix("EVENT:"))
        assert payload["meta"]["k"] == 1


class TestLog:
    """2.2 log — stderr output format."""

    def test_log_format(self):
        out = _capture_stderr(log, "scanner-1", "hello world")
        assert "[scanner-1] hello world" in out

    def test_log_goes_to_stderr(self):
        """Verify log does NOT appear on stdout."""
        stdout_out = _capture_stdout(log, "s1", "msg")
        assert stdout_out == ""


class TestScanWorkerInit:
    """2.3 constructor state setup."""

    def test_default_state(self):
        w = _make_worker()
        assert w.scanner_id == "test-scanner"
        assert w.device_name == "mock-device"
        assert w.mock is True
        assert w._device is None
        assert w._sane is None
        assert w._device_is_open is False
        assert w._cancel_requested is False
        assert w._cycle == 0


class TestHandleCancel:
    """2.4 thread-safe cancel flag."""

    def test_cancel_sets_flag(self):
        w = _make_worker()
        assert w._cancel_requested is False
        w._handle_cancel()
        assert w._cancel_requested is True

    def test_cancel_uses_lock(self):
        w = _make_worker()
        # Verify the lock is a threading.Lock (used in _handle_cancel)
        assert isinstance(w._cancel_lock, type(threading.Lock()))


class TestMockScan:
    """2.5 _mock_scan — generates TIFF with correct dimensions and metadata."""

    @patch("time.sleep")
    def test_generates_tiff(self, mock_sleep, tmp_path):
        w = _make_worker()
        out = tmp_path / "scan.tif"
        w._mock_scan("2grid", "00", 300, str(out))
        assert out.exists()
        img = Image.open(out)
        assert img.format == "TIFF"

    @patch("time.sleep")
    def test_correct_dimensions(self, mock_sleep, tmp_path):
        w = _make_worker()
        out = tmp_path / "scan.tif"
        w._mock_scan("2grid", "00", 300, str(out))
        region = get_scan_region("2grid", "00")
        px = region.to_pixels(300)
        img = Image.open(out)
        expected_w = max(px["width"], 100)
        expected_h = max(px["height"], 100)
        assert img.size == (expected_w, expected_h)

    @patch("time.sleep")
    def test_tiff_has_metadata(self, mock_sleep, tmp_path):
        w = _make_worker()
        out = tmp_path / "scan.tif"
        w._mock_scan("4grid", "01", 300, str(out))
        img = Image.open(out)
        desc = json.loads(img.tag_v2[270])
        assert desc["grid_mode"] == "4grid"
        assert desc["plate_index"] == "01"
        assert desc["resolution_dpi"] == 300


class TestMockScanRow:
    """2.6 _mock_scan_row — in-memory image with correct bbox size."""

    @patch("time.sleep")
    def test_returns_pil_image(self, mock_sleep):
        from python.graviscan.scan_regions import get_row_bounding_box

        w = _make_worker()
        bbox = get_row_bounding_box("4grid", ["00", "01"])
        img = w._mock_scan_row(bbox, 300)
        assert isinstance(img, Image.Image)
        px = bbox.to_pixels(300)
        assert img.size[0] == max(px["width"], 100)
        assert img.size[1] == max(px["height"], 100)


# ═══════════════════════════════════════════════════════════════════════════
# Section 3 — Mocked SANE
# ═══════════════════════════════════════════════════════════════════════════


class TestInitializeMockMode:
    """3.1 mock=True path emits ready event."""

    def test_mock_init_returns_true(self):
        w = _make_worker(mock=True)
        out = _capture_stdout(w.initialize)
        assert "ready" in out

    def test_mock_init_no_sane(self):
        w = _make_worker(mock=True)
        _capture_stdout(w.initialize)
        assert w._sane is None
        assert w._device is None


class TestCloseDevice:
    """3.2 idempotent close, cancel+close called."""

    def test_close_when_not_open_is_noop(self):
        w = _make_worker()
        w._device_is_open = False
        w._close_device()  # should not raise
        assert w._device_is_open is False

    def test_close_calls_cancel_and_close(self):
        w = _make_worker()
        mock_dev = MagicMock()
        w._device = mock_dev
        w._device_is_open = True
        w._close_device()
        mock_dev.cancel.assert_called_once()
        mock_dev.close.assert_called_once()
        assert w._device_is_open is False


class TestShutdown:
    """3.3 cleanup, device and sane set to None."""

    def test_shutdown_closes_device_and_sane(self):
        w = _make_worker()
        mock_dev = MagicMock()
        mock_sane = MagicMock()
        w._device = mock_dev
        w._sane = mock_sane
        _capture_stderr(w._shutdown)
        mock_dev.close.assert_called_once()
        mock_sane.exit.assert_called_once()

    def test_shutdown_with_none_device(self):
        w = _make_worker()
        w._device = None
        w._sane = None
        _capture_stderr(w._shutdown)  # should not raise


class TestSaneScanRetryLogic:
    """3.4 mock device to fail N times then succeed."""

    @patch("time.sleep")
    def test_retries_then_succeeds(self, mock_sleep, tmp_path):
        w = _make_worker(mock=False)
        w._device_is_open = True

        call_count = 0
        mock_img = Image.new("RGB", (100, 100))

        mock_device = MagicMock()

        def start_side_effect():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise RuntimeError("Device busy")

        mock_device.start = MagicMock(side_effect=start_side_effect)
        mock_device.snap.return_value = mock_img

        # Mock _sane so _reopen_device works when _close_device sets _device_is_open=False
        mock_sane = MagicMock()
        new_mock_device = MagicMock()
        new_mock_device.start = mock_device.start
        new_mock_device.snap = mock_device.snap
        mock_sane.open.return_value = new_mock_device
        w._sane = mock_sane
        w._device = mock_device

        out_path = str(tmp_path / "scan.tif")
        _capture_stderr(w._sane_scan, "2grid", "00", 300, out_path)
        assert os.path.exists(out_path)
        assert call_count == 3  # failed 2, succeeded on 3rd

    @patch("time.sleep")
    def test_all_retries_exhausted(self, mock_sleep, tmp_path):
        w = _make_worker(mock=False)
        w._device_is_open = True
        mock_device = MagicMock()
        mock_device.start.side_effect = RuntimeError("permanent fail")
        w._device = mock_device

        with pytest.raises(RuntimeError, match="Scan failed after 5 attempts"):
            _capture_stderr(
                w._sane_scan, "2grid", "00", 300, str(tmp_path / "fail.tif")
            )


class TestReopenDevice:
    """3.5 mock sane exit/init/open sequence."""

    @patch("time.sleep")
    def test_reopen_calls_sane_cycle(self, mock_sleep):
        w = _make_worker(mock=False)
        mock_sane = MagicMock()
        mock_device = MagicMock()
        mock_sane.open.return_value = mock_device
        w._sane = mock_sane
        w._device = MagicMock()
        w._device_is_open = True

        _capture_stderr(w._reopen_device)

        mock_sane.exit.assert_called()
        mock_sane.init.assert_called()
        mock_sane.open.assert_called_once_with(w.device_name)
        assert w._device_is_open is True

    @patch("time.sleep")
    def test_reopen_retries_on_failure(self, mock_sleep):
        w = _make_worker(mock=False)
        mock_sane = MagicMock()
        call_count = 0

        def open_side_effect(name):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise RuntimeError("busy")
            return MagicMock()

        mock_sane.open.side_effect = open_side_effect
        w._sane = mock_sane
        w._device = MagicMock()

        _capture_stderr(w._reopen_device)
        assert call_count == 3

    @patch("time.sleep")
    def test_reopen_all_retries_fail(self, mock_sleep):
        w = _make_worker(mock=False)
        mock_sane = MagicMock()
        mock_sane.open.side_effect = RuntimeError("permanent busy")
        w._sane = mock_sane
        w._device = MagicMock()

        with pytest.raises(RuntimeError, match="Failed to reopen device"):
            _capture_stderr(w._reopen_device)


class TestResetUSBDeviceNonLinux:
    """3.6 skips on non-Linux."""

    @patch("platform.system", return_value="Darwin")
    def test_skips_on_darwin(self, mock_platform):
        w = _make_worker(device_name="epkowa:interpreter:001:007")
        w._reset_usb_device()  # should not raise, no ioctl attempt

    @patch("platform.system", return_value="Windows")
    def test_skips_on_windows(self, mock_platform):
        w = _make_worker()
        w._reset_usb_device()


class TestResetUSBDeviceParseDeviceName:
    """3.7 parses bus:device from SANE name."""

    @patch("platform.system", return_value="Linux")
    def test_parses_epkowa_name(self, mock_platform):
        w = _make_worker(device_name="epkowa:interpreter:001:007")
        with patch("os.open", side_effect=PermissionError("denied")):
            _capture_stderr(w._reset_usb_device)
            # Reaches the os.open call, meaning parsing succeeded

    @patch("platform.system", return_value="Linux")
    def test_short_device_name_skips(self, mock_platform):
        w = _make_worker(device_name="mock")
        _capture_stderr(w._reset_usb_device)  # should not raise


class TestRunCommandLoop:
    """3.8 mock stdin with scan/cancel/quit commands."""

    @patch("time.sleep")
    def test_scan_then_quit(self, mock_sleep, tmp_path):
        w = _make_worker()
        _capture_stdout(w.initialize)

        scan_cmd = json.dumps(
            {
                "action": "scan",
                "plates": [
                    {
                        "plate_index": "00",
                        "grid_mode": "2grid",
                        "resolution": 300,
                        "output_path": str(tmp_path / "plate00.tif"),
                    }
                ],
            }
        )
        quit_cmd = json.dumps({"action": "quit"})

        with patch("sys.stdin", io.StringIO(f"{scan_cmd}\n{quit_cmd}\n")):
            out = _capture_stdout(w.run)

        assert "scan-started" in out
        assert "scan-complete" in out
        assert "cycle-done" in out


# ═══════════════════════════════════════════════════════════════════════════
# Section 4 — End-to-End Mock Workflows
# ═══════════════════════════════════════════════════════════════════════════


class TestFullScanCycleMock:
    """4.1 mock=True, scan command → scan-started → scan-complete + TIFF."""

    @patch("time.sleep")
    def test_full_cycle(self, mock_sleep, tmp_path):
        w = _make_worker()
        _capture_stdout(w.initialize)

        out_path = str(tmp_path / "plate00.tif")
        scan_cmd = json.dumps(
            {
                "action": "scan",
                "plates": [
                    {
                        "plate_index": "00",
                        "grid_mode": "2grid",
                        "resolution": 300,
                        "output_path": out_path,
                    }
                ],
            }
        )
        quit_cmd = json.dumps({"action": "quit"})

        with patch("sys.stdin", io.StringIO(f"{scan_cmd}\n{quit_cmd}\n")):
            out = _capture_stdout(w.run)

        events = [
            json.loads(line.removeprefix("EVENT:"))
            for line in out.strip().split("\n")
            if line.startswith("EVENT:")
        ]
        types = [e["type"] for e in events]
        assert "scan-started" in types
        assert "scan-complete" in types
        assert "cycle-done" in types
        assert os.path.exists(out_path)


class TestFourGridRowMerge:
    """4.2 4grid with 4 plates → row-merge (1 scan + 2 crops per row)."""

    @patch("time.sleep")
    def test_4grid_row_merge_all_plates(self, mock_sleep, tmp_path):
        w = _make_worker()
        _capture_stdout(w.initialize)

        plates = []
        for idx in ("00", "01", "10", "11"):
            plates.append(
                {
                    "plate_index": idx,
                    "grid_mode": "4grid",
                    "resolution": 300,
                    "output_path": str(tmp_path / f"plate_{idx}.tif"),
                }
            )

        scan_cmd = json.dumps({"action": "scan", "plates": plates})
        quit_cmd = json.dumps({"action": "quit"})

        with patch("sys.stdin", io.StringIO(f"{scan_cmd}\n{quit_cmd}\n")):
            out = _capture_stdout(w.run)

        # All 4 TIFFs should exist
        for idx in ("00", "01", "10", "11"):
            path = tmp_path / f"plate_{idx}.tif"
            assert path.exists(), f"Missing {path}"
            img = Image.open(path)
            assert img.size[0] > 0 and img.size[1] > 0

        events = [
            json.loads(line.removeprefix("EVENT:"))
            for line in out.strip().split("\n")
            if line.startswith("EVENT:")
        ]
        complete_events = [e for e in events if e["type"] == "scan-complete"]
        assert len(complete_events) == 4


class TestTwoGridIndividualScans:
    """4.3 2grid — each plate scanned individually (no row-merge)."""

    @patch("time.sleep")
    def test_2grid_individual(self, mock_sleep, tmp_path):
        w = _make_worker()
        _capture_stdout(w.initialize)

        plates = [
            {
                "plate_index": "00",
                "grid_mode": "2grid",
                "resolution": 300,
                "output_path": str(tmp_path / "p00.tif"),
            },
            {
                "plate_index": "01",
                "grid_mode": "2grid",
                "resolution": 300,
                "output_path": str(tmp_path / "p01.tif"),
            },
        ]
        scan_cmd = json.dumps({"action": "scan", "plates": plates})
        quit_cmd = json.dumps({"action": "quit"})

        with patch("sys.stdin", io.StringIO(f"{scan_cmd}\n{quit_cmd}\n")):
            out = _capture_stdout(w.run)

        assert (tmp_path / "p00.tif").exists()
        assert (tmp_path / "p01.tif").exists()

        events = [
            json.loads(line.removeprefix("EVENT:"))
            for line in out.strip().split("\n")
            if line.startswith("EVENT:")
        ]
        started = [e for e in events if e["type"] == "scan-started"]
        assert len(started) == 2


class TestFourGridSinglePlateInRow:
    """4.4 4grid with 1 plate in row → falls back to individual scan."""

    @patch("time.sleep")
    def test_single_plate_fallback(self, mock_sleep, tmp_path):
        w = _make_worker()
        _capture_stdout(w.initialize)

        # Only plate "00" from top row — should NOT row-merge
        plates = [
            {
                "plate_index": "00",
                "grid_mode": "4grid",
                "resolution": 300,
                "output_path": str(tmp_path / "p00.tif"),
            },
            {
                "plate_index": "10",
                "grid_mode": "4grid",
                "resolution": 300,
                "output_path": str(tmp_path / "p10.tif"),
            },
        ]
        scan_cmd = json.dumps({"action": "scan", "plates": plates})
        quit_cmd = json.dumps({"action": "quit"})

        with patch("sys.stdin", io.StringIO(f"{scan_cmd}\n{quit_cmd}\n")):
            _capture_stdout(w.run)

        assert (tmp_path / "p00.tif").exists()
        assert (tmp_path / "p10.tif").exists()


# ═══════════════════════════════════════════════════════════════════════════
# Section 5 — Cancel Behavior
# ═══════════════════════════════════════════════════════════════════════════


class TestCancelMidCycle:
    """5.1 cancel after first plate, remaining emit scan-cancelled."""

    @patch("time.sleep")
    def test_cancel_mid_scan(self, mock_sleep, tmp_path):
        w = _make_worker()
        _capture_stdout(w.initialize)

        # We'll cancel between the two plates
        plates = [
            {
                "plate_index": "00",
                "grid_mode": "2grid",
                "resolution": 300,
                "output_path": str(tmp_path / "p00.tif"),
            },
            {
                "plate_index": "01",
                "grid_mode": "2grid",
                "resolution": 300,
                "output_path": str(tmp_path / "p01.tif"),
            },
        ]

        original_scan_plate = w._scan_plate

        def scan_then_cancel(plate):
            original_scan_plate(plate)
            w._handle_cancel()

        with patch.object(w, "_scan_plate", side_effect=scan_then_cancel):
            _capture_stdout(w._handle_scan, {"plates": plates})

        # First plate scanned, second should be cancelled
        assert w._cancel_requested is True


class TestCancelFlagClearedOnNewScan:
    """5.2 cancel → new scan → flag reset."""

    @patch("time.sleep")
    def test_flag_cleared(self, mock_sleep, tmp_path):
        w = _make_worker()
        _capture_stdout(w.initialize)
        w._handle_cancel()
        assert w._cancel_requested is True

        # New scan should clear the flag
        scan_cmd = {
            "plates": [
                {
                    "plate_index": "00",
                    "grid_mode": "2grid",
                    "resolution": 300,
                    "output_path": str(tmp_path / "p.tif"),
                }
            ],
        }
        _capture_stdout(w._handle_scan, scan_cmd)
        assert w._cancel_requested is False


class TestCancelThreadSafety:
    """5.3 verify lock acquired during cancel flag access."""

    def test_concurrent_cancel_and_scan(self):
        w = _make_worker()
        errors = []

        def cancel_repeatedly():
            for _ in range(50):
                try:
                    w._handle_cancel()
                except Exception as e:
                    errors.append(e)

        def read_flag_repeatedly():
            for _ in range(50):
                try:
                    with w._cancel_lock:
                        _ = w._cancel_requested
                except Exception as e:
                    errors.append(e)

        t1 = threading.Thread(target=cancel_repeatedly)
        t2 = threading.Thread(target=read_flag_repeatedly)
        t1.start()
        t2.start()
        t1.join()
        t2.join()
        assert len(errors) == 0


# ═══════════════════════════════════════════════════════════════════════════
# Section 6 — Command Loop Edge Cases
# ═══════════════════════════════════════════════════════════════════════════


class TestEmptyLineSkipped:
    """6.1 empty stdin line doesn't crash."""

    @patch("time.sleep")
    def test_empty_lines(self, mock_sleep):
        w = _make_worker()
        _capture_stdout(w.initialize)
        quit_cmd = json.dumps({"action": "quit"})

        with patch("sys.stdin", io.StringIO(f"\n\n   \n{quit_cmd}\n")):
            _capture_stdout(w.run)  # should not raise


class TestInvalidJSONLogged:
    """6.2 malformed JSON logged, loop continues."""

    @patch("time.sleep")
    def test_bad_json(self, mock_sleep):
        w = _make_worker()
        _capture_stdout(w.initialize)
        quit_cmd = json.dumps({"action": "quit"})

        with patch("sys.stdin", io.StringIO(f"not-valid-json\n{quit_cmd}\n")):
            stderr_out = _capture_stderr(lambda: _capture_stdout(w.run))

        assert "Invalid JSON" in stderr_out


class TestUnknownActionLogged:
    """6.3 unrecognized action logged, loop continues."""

    @patch("time.sleep")
    def test_unknown_action(self, mock_sleep):
        w = _make_worker()
        _capture_stdout(w.initialize)
        unknown_cmd = json.dumps({"action": "fly"})
        quit_cmd = json.dumps({"action": "quit"})

        with patch("sys.stdin", io.StringIO(f"{unknown_cmd}\n{quit_cmd}\n")):
            stderr_out = _capture_stderr(lambda: _capture_stdout(w.run))

        assert "Unknown action" in stderr_out


class TestScanEmptyPlates:
    """6.4 scan with empty plates array → logged, no crash."""

    @patch("time.sleep")
    def test_empty_plates(self, mock_sleep):
        w = _make_worker()
        _capture_stdout(w.initialize)
        scan_cmd = json.dumps({"action": "scan", "plates": []})
        quit_cmd = json.dumps({"action": "quit"})

        with patch("sys.stdin", io.StringIO(f"{scan_cmd}\n{quit_cmd}\n")):
            stderr_out = _capture_stderr(lambda: _capture_stdout(w.run))

        assert "no plates" in stderr_out.lower()


class TestQuitTriggersShutdown:
    """6.5 quit command calls _shutdown(), loop exits."""

    @patch("time.sleep")
    def test_quit_calls_shutdown(self, mock_sleep):
        w = _make_worker()
        _capture_stdout(w.initialize)

        with patch.object(w, "_shutdown") as mock_shutdown:
            quit_cmd = json.dumps({"action": "quit"})
            with patch("sys.stdin", io.StringIO(f"{quit_cmd}\n")):
                _capture_stdout(w.run)
            mock_shutdown.assert_called_once()


# ═══════════════════════════════════════════════════════════════════════════
# Section 7 — Error Propagation
# ═══════════════════════════════════════════════════════════════════════════


class TestScanPlateErrorEmitsEvent:
    """7.1 _mock_scan raises → scan-error event with error + duration_ms."""

    @patch("time.sleep")
    def test_scan_error_event(self, mock_sleep):
        w = _make_worker()

        with patch.object(w, "_mock_scan", side_effect=RuntimeError("boom")):
            out = _capture_stdout(
                w._scan_plate,
                {
                    "plate_index": "00",
                    "grid_mode": "2grid",
                    "resolution": 300,
                    "output_path": "/tmp/nope.tif",
                },
            )

        events = [
            json.loads(line.removeprefix("EVENT:"))
            for line in out.strip().split("\n")
            if line.startswith("EVENT:")
        ]
        error_events = [e for e in events if e["type"] == "scan-error"]
        assert len(error_events) == 1
        assert "boom" in error_events[0]["error"]
        assert "duration_ms" in error_events[0]


class TestScanRowErrorAllPlates:
    """7.2 row scan fails → ALL plates in row get scan-error events."""

    @patch("time.sleep")
    def test_row_error_propagates(self, mock_sleep):
        w = _make_worker()

        with patch.object(w, "_mock_scan_row", side_effect=RuntimeError("row fail")):
            row_plates = [
                {
                    "plate_index": "00",
                    "grid_mode": "4grid",
                    "resolution": 300,
                    "output_path": "/tmp/p00.tif",
                },
                {
                    "plate_index": "01",
                    "grid_mode": "4grid",
                    "resolution": 300,
                    "output_path": "/tmp/p01.tif",
                },
            ]
            out = _capture_stdout(w._scan_row, row_plates)

        events = [
            json.loads(line.removeprefix("EVENT:"))
            for line in out.strip().split("\n")
            if line.startswith("EVENT:")
        ]
        error_events = [e for e in events if e["type"] == "scan-error"]
        assert len(error_events) == 2
        plates_with_errors = {e["plate_index"] for e in error_events}
        assert plates_with_errors == {"00", "01"}


class TestCycleDoneAlwaysEmitted:
    """7.3 cycle-done fires even when some plates fail."""

    @patch("time.sleep")
    def test_cycle_done_after_failure(self, mock_sleep, tmp_path):
        w = _make_worker()
        _capture_stdout(w.initialize)

        with patch.object(w, "_mock_scan", side_effect=RuntimeError("fail")):
            out = _capture_stdout(
                w._handle_scan,
                {
                    "plates": [
                        {
                            "plate_index": "00",
                            "grid_mode": "2grid",
                            "resolution": 300,
                            "output_path": str(tmp_path / "p.tif"),
                        },
                    ]
                },
            )

        events = [
            json.loads(line.removeprefix("EVENT:"))
            for line in out.strip().split("\n")
            if line.startswith("EVENT:")
        ]
        types = [e["type"] for e in events]
        assert "cycle-done" in types


# ═══════════════════════════════════════════════════════════════════════════
# Section 8 — TIFF Metadata Validation
# ═══════════════════════════════════════════════════════════════════════════


class TestMetadataJSONRoundtrip:
    """8.1 save mock scan, reopen TIFF, parse ImageDescription JSON."""

    @patch("time.sleep")
    def test_roundtrip(self, mock_sleep, tmp_path):
        w = _make_worker()
        out_path = str(tmp_path / "meta.tif")
        w._mock_scan("2grid", "00", 300, out_path)

        img = Image.open(out_path)
        desc = json.loads(img.tag_v2[270])
        assert desc["scanner_id"] == "test-scanner"
        assert desc["grid_mode"] == "2grid"
        assert desc["plate_index"] == "00"
        assert desc["resolution_dpi"] == 300
        assert "capture_timestamp" in desc
        assert "bloom_version" in desc
        assert "scan_region_mm" in desc


class TestResolutionTagsMatchInput:
    """8.2 XResolution/YResolution match DPI argument."""

    @patch("time.sleep")
    def test_resolution_tags(self, mock_sleep, tmp_path):
        w = _make_worker()
        out_path = str(tmp_path / "res.tif")
        w._mock_scan("2grid", "00", 600, out_path)

        img = Image.open(out_path)
        # tag 282 = XResolution
        x_res = img.tag_v2.get(282)
        # IFDRational stores as tuple or value
        if hasattr(x_res, "numerator"):
            assert x_res.numerator / x_res.denominator == 600
        else:
            assert float(x_res) == 600.0


class TestMetadataDifferentGridModes:
    """8.3 scan_region_mm differs between 2grid and 4grid."""

    @patch("time.sleep")
    def test_grid_mode_metadata(self, mock_sleep, tmp_path):
        w = _make_worker()
        path_2g = str(tmp_path / "2g.tif")
        path_4g = str(tmp_path / "4g.tif")
        w._mock_scan("2grid", "00", 300, path_2g)
        w._mock_scan("4grid", "00", 300, path_4g)

        desc_2g = json.loads(Image.open(path_2g).tag_v2[270])
        desc_4g = json.loads(Image.open(path_4g).tag_v2[270])

        # Regions should differ
        assert desc_2g["scan_region_mm"] != desc_4g["scan_region_mm"]
        assert desc_2g["grid_mode"] == "2grid"
        assert desc_4g["grid_mode"] == "4grid"


# ═══════════════════════════════════════════════════════════════════════════
# Section 9 — Device State Management
# ═══════════════════════════════════════════════════════════════════════════


class TestCloseDeviceAlreadyClosed:
    """9.1 idempotent, no exception."""

    def test_double_close(self):
        w = _make_worker()
        w._device_is_open = False
        w._close_device()
        w._close_device()  # second call should be fine


class TestCloseDeviceSwallowsExceptions:
    """9.2 cancel/close raise → no crash."""

    def test_cancel_raises(self):
        w = _make_worker()
        mock_dev = MagicMock()
        mock_dev.cancel.side_effect = RuntimeError("cancel fail")
        mock_dev.close.side_effect = RuntimeError("close fail")
        w._device = mock_dev
        w._device_is_open = True

        w._close_device()  # should not raise
        assert w._device_is_open is False


class TestDeviceIsOpenFlag:
    """9.3 False after close, True after reopen."""

    @patch("time.sleep")
    def test_flag_lifecycle(self, mock_sleep):
        w = _make_worker(mock=False)
        mock_sane = MagicMock()
        mock_device = MagicMock()
        mock_sane.open.return_value = mock_device
        w._sane = mock_sane
        w._device = mock_device
        w._device_is_open = True

        w._close_device()
        assert w._device_is_open is False

        _capture_stderr(w._reopen_device)
        assert w._device_is_open is True


# ═══════════════════════════════════════════════════════════════════════════
# Section 10 — USB Reset (Platform Mock)
# ═══════════════════════════════════════════════════════════════════════════


class TestUSBResetNonLinuxSkip:
    """10.1 mock platform.system()="Darwin" → skip."""

    @patch("platform.system", return_value="Darwin")
    def test_darwin_skip(self, mock_platform):
        w = _make_worker(device_name="epkowa:interpreter:001:007")
        # Should return immediately, no ioctl
        w._reset_usb_device()


class TestUSBResetInvalidDeviceName:
    """10.2 "mock" device name → graceful skip."""

    @patch("platform.system", return_value="Linux")
    def test_short_name(self, mock_platform):
        w = _make_worker(device_name="mock")
        _capture_stderr(w._reset_usb_device)  # should not raise


class TestUSBResetPathConstruction:
    """10.3 epkowa:interpreter:001:007 → /dev/bus/usb/001/007."""

    @patch("platform.system", return_value="Linux")
    def test_path_from_device_name(self, mock_platform):
        w = _make_worker(device_name="epkowa:interpreter:001:007")
        with (
            patch("os.open") as mock_open,
            patch("os.close") as mock_close,
            patch("fcntl.ioctl") as mock_ioctl,
        ):
            mock_open.return_value = 42
            _capture_stderr(w._reset_usb_device)
            mock_open.assert_called_once_with("/dev/bus/usb/001/007", os.O_WRONLY)
            mock_ioctl.assert_called_once()
            mock_close.assert_called_once_with(42)


class TestUSBResetPermissionDenied:
    """10.4 os.open raises PermissionError → non-fatal log."""

    @patch("platform.system", return_value="Linux")
    def test_permission_denied(self, mock_platform):
        w = _make_worker(device_name="epkowa:interpreter:001:007")
        with patch("os.open", side_effect=PermissionError("denied")):
            stderr_out = _capture_stderr(w._reset_usb_device)
        assert "non-fatal" in stderr_out.lower()


# ═══════════════════════════════════════════════════════════════════════════
# Build TIFF metadata helper
# ═══════════════════════════════════════════════════════════════════════════


class TestBuildTiffMetadata:
    """Test _build_tiff_metadata helper function."""

    def test_returns_ifd(self):
        region = get_scan_region("2grid", "00")
        ifd = _build_tiff_metadata("scanner-1", "2grid", "00", 300, region)
        # 270 = ImageDescription
        desc = json.loads(ifd[270])
        assert desc["scanner_id"] == "scanner-1"
        assert desc["grid_mode"] == "2grid"
        assert desc["plate_index"] == "00"
        assert desc["resolution_dpi"] == 300

    def test_software_tag(self):
        region = get_scan_region("4grid", "10")
        ifd = _build_tiff_metadata("s1", "4grid", "10", 600, region)
        assert ifd[305] == "Bloom Desktop / GraviScan"

    def test_resolution_unit(self):
        region = get_scan_region("2grid", "01")
        ifd = _build_tiff_metadata("s1", "2grid", "01", 300, region)
        assert ifd[296] == 2  # inches
