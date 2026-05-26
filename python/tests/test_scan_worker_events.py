"""Task 0 (#236 prerequisite): scan-error event payload extended with
bytes_received + wall_seconds fields, and timing migrated to
time.monotonic() for clock-skew immunity.

These tests verify the contract change to the scan-error event so the
WedgeDetector (Task 5) can rely on the new fields.
"""

import io
import json
import os
import sys
from unittest.mock import patch

import pytest

from python.graviscan.scan_worker import ScanWorker


# ── Helpers ──────────────────────────────────────────────────────────────────


def _capture_stdout(func, *args, **kwargs):
    buf = io.StringIO()
    old = sys.stdout
    sys.stdout = buf
    try:
        func(*args, **kwargs)
    finally:
        sys.stdout = old
    return buf.getvalue()


def _parse_events(stdout: str) -> list[dict]:
    """Extract EVENT: lines from stdout, parse as JSON."""
    events = []
    for line in stdout.split("\n"):
        if line.startswith("EVENT:"):
            events.append(json.loads(line.removeprefix("EVENT:")))
    return events


def _make_worker(scanner_id="test-scanner", device_name="mock-device", mock=True):
    return ScanWorker(scanner_id=scanner_id, device_name=device_name, mock=mock)


def _make_plate(
    output_dir,
    plate_index="00",
    grid_mode="2grid",
    resolution=300,
    *,
    exp_name="exp",
    st_timestamp="20260301T120000",
    wave_number=1,
    scanner_tag="Sc1",
    system_prefix="",
    cycle=1,
    phenotyper_name="",
):
    return {
        "plate_index": plate_index,
        "grid_mode": grid_mode,
        "resolution": resolution,
        "output_dir": str(output_dir),
        "exp_name": exp_name,
        "st_timestamp": st_timestamp,
        "wave_number": wave_number,
        "scanner_tag": scanner_tag,
        "system_prefix": system_prefix,
        "cycle": cycle,
        "phenotyper_name": phenotyper_name,
    }


# ── Tests ────────────────────────────────────────────────────────────────────


class TestScanErrorEventFields:
    """scan-error events MUST include bytes_received + wall_seconds in
    addition to existing fields."""

    @patch("time.sleep")  # skip 0.5s mock-scan delay
    def test_scan_error_includes_bytes_received_and_wall_seconds(
        self, _mock_sleep, tmp_path
    ):
        """Force _mock_scan to raise; assert scan-error event has both new
        fields plus existing ones unchanged."""
        w = _make_worker()
        plate = _make_plate(tmp_path)

        # Force _mock_scan to raise to trigger the scan-error path
        with patch.object(
            w, "_mock_scan", side_effect=RuntimeError("synthetic failure")
        ):
            stdout = _capture_stdout(w._scan_plate, plate)

        events = _parse_events(stdout)
        scan_errors = [e for e in events if e["type"] == "scan-error"]
        assert len(scan_errors) == 1, f"expected 1 scan-error, got events: {events}"
        evt = scan_errors[0]

        # New required fields
        assert "bytes_received" in evt, "scan-error missing bytes_received"
        assert isinstance(evt["bytes_received"], int)
        assert "wall_seconds" in evt, "scan-error missing wall_seconds"
        assert isinstance(evt["wall_seconds"], float)

        # Existing fields unchanged
        assert evt["type"] == "scan-error"
        assert evt["scanner_id"] == "test-scanner"
        assert evt["plate_index"] == "00"
        assert "job_id" in evt
        assert "error" in evt
        assert "synthetic failure" in evt["error"]
        assert "duration_ms" in evt  # existing field — preserved

    @patch("time.sleep")
    def test_bytes_received_zero_when_failure_before_image_received(
        self, _mock_sleep, tmp_path
    ):
        """When the scan fails before any bytes are received (most common
        wedge case), bytes_received SHALL be 0."""
        w = _make_worker()
        plate = _make_plate(tmp_path)

        # _mock_scan raises before image generation (simulates sane.start failure)
        with patch.object(
            w,
            "_mock_scan",
            side_effect=RuntimeError("sane_start: Invalid argument"),
        ):
            stdout = _capture_stdout(w._scan_plate, plate)

        events = _parse_events(stdout)
        scan_errors = [e for e in events if e["type"] == "scan-error"]
        assert len(scan_errors) == 1
        assert scan_errors[0]["bytes_received"] == 0

    @patch("time.sleep")
    def test_wall_seconds_uses_monotonic(self, _mock_sleep, tmp_path):
        """wall_seconds SHALL be measured via time.monotonic() (not time.time()).
        We verify by mocking time.monotonic to return controlled values."""
        w = _make_worker()
        plate = _make_plate(tmp_path)

        # First monotonic() call: scan start. Second: error emission.
        with (
            patch(
                "python.graviscan.scan_worker.time.monotonic",
                side_effect=[100.0, 200.0],
            ),
            patch.object(w, "_mock_scan", side_effect=RuntimeError("boom")),
        ):
            stdout = _capture_stdout(w._scan_plate, plate)

        events = _parse_events(stdout)
        scan_errors = [e for e in events if e["type"] == "scan-error"]
        assert len(scan_errors) == 1
        evt = scan_errors[0]
        # wall_seconds should equal 200.0 - 100.0 = 100.0
        assert evt["wall_seconds"] == pytest.approx(100.0, abs=0.01)


class TestScanCompleteEventTiming:
    """scan-complete events use time.monotonic() for duration_ms (timing
    consistency with scan-error.wall_seconds)."""

    @patch("time.sleep")
    def test_duration_ms_uses_monotonic_on_success(self, _mock_sleep, tmp_path):
        """duration_ms SHALL be derived from time.monotonic() so it is
        immune to wall-clock adjustments and consistent with
        wall_seconds."""
        w = _make_worker()
        plate = _make_plate(tmp_path)

        # First call: scan start. Second call: completion.
        with patch(
            "python.graviscan.scan_worker.time.monotonic",
            side_effect=[10.0, 15.0],
        ):
            stdout = _capture_stdout(w._scan_plate, plate)

        events = _parse_events(stdout)
        scan_completes = [e for e in events if e["type"] == "scan-complete"]
        assert len(scan_completes) == 1
        # duration_ms = (15.0 - 10.0) * 1000 = 5000
        assert scan_completes[0]["duration_ms"] == 5000

    @patch("time.sleep")
    def test_duration_ms_and_wall_seconds_use_same_clock(self, _mock_sleep, tmp_path):
        """On a failed scan, duration_ms (int ms) and wall_seconds (float s)
        SHALL both come from the same monotonic clock — their values
        SHALL agree within 10 ms."""
        w = _make_worker()
        plate = _make_plate(tmp_path)

        # Two monotonic readings: start, error
        with (
            patch(
                "python.graviscan.scan_worker.time.monotonic",
                side_effect=[50.0, 57.123],
            ),
            patch.object(w, "_mock_scan", side_effect=RuntimeError("err")),
        ):
            stdout = _capture_stdout(w._scan_plate, plate)

        events = _parse_events(stdout)
        scan_errors = [e for e in events if e["type"] == "scan-error"]
        assert len(scan_errors) == 1
        evt = scan_errors[0]

        wall_ms = evt["wall_seconds"] * 1000.0
        # duration_ms is int rounding; allow up to 10 ms gap
        assert abs(evt["duration_ms"] - wall_ms) <= 10


class TestSuccessfulMockScanBytesReceived:
    """On a successful mock scan, bytes_received SHALL reflect approximate
    raw RGB bytes of the rendered image (width * height * 3)."""

    @patch("time.sleep")
    def test_successful_mock_scan_does_not_emit_scan_error(self, _mock_sleep, tmp_path):
        """A clean mock scan path produces a scan-complete event, no
        scan-error. We don't assert bytes_received on the success path
        directly (scan-complete carries duration_ms, not bytes); just
        confirm the successful path is unaffected by the new fields."""
        w = _make_worker()
        plate = _make_plate(tmp_path)

        stdout = _capture_stdout(w._scan_plate, plate)
        events = _parse_events(stdout)

        scan_errors = [e for e in events if e["type"] == "scan-error"]
        scan_completes = [e for e in events if e["type"] == "scan-complete"]
        assert len(scan_errors) == 0, f"unexpected scan-error: {events}"
        assert len(scan_completes) == 1
