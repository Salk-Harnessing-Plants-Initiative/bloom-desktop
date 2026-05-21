"""Task 8 (#232): DPI runtime validation warn in scan_worker.

Defense-in-depth against future code paths that bypass the trimmed
UI dropdown. If a scan is requested at a DPI outside the V600-validated
set {200, 400, 600, 800, 1200, 1600}, the worker logs a warning and
emits a `dpi-warning` event with documented JSON shape, but PROCEEDS
with the scan (the SANE backend may round internally).

Per investigation summary Section 2.2: the V600's actual SANE driver
reports only {400, 800, 1600, 3200} for the generic `--resolution`
flag, but the production code uses `x_resolution`/`y_resolution`
which honor 1200 dpi natively (per #233). The trimmed set is the
empirically-validated production set.
"""

import io
import json
import re
import sys
from unittest.mock import patch

import pytest

from python.graviscan.scan_worker import ScanWorker, _validate_dpi, V600_VALIDATED_DPI


def _capture_stdout(func, *args, **kwargs):
    buf = io.StringIO()
    old = sys.stdout
    sys.stdout = buf
    try:
        func(*args, **kwargs)
    finally:
        sys.stdout = old
    return buf.getvalue()


def _capture_stderr(func, *args, **kwargs):
    buf = io.StringIO()
    old = sys.stderr
    sys.stderr = buf
    try:
        func(*args, **kwargs)
    finally:
        sys.stderr = old
    return buf.getvalue()


def _parse_events(stdout: str) -> list[dict]:
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
    resolution=1200,
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


class TestValidatedDpiSet:
    """V600_VALIDATED_DPI SHALL be the empirically-validated production set."""

    def test_set_membership(self):
        assert V600_VALIDATED_DPI == {200, 400, 600, 800, 1200, 1600}


class TestValidateDpiHelper:
    """_validate_dpi(dpi) returns True for in-set values, False for others."""

    def test_validated_dpi_returns_true(self):
        for dpi in [200, 400, 600, 800, 1200, 1600]:
            assert _validate_dpi(dpi) is True, f"{dpi} should be valid"

    def test_unvalidated_dpi_returns_false(self):
        for dpi in [300, 750, 1000, 1500, 3200, 6400]:
            assert _validate_dpi(dpi) is False, f"{dpi} should be invalid"


class TestDpiWarningEventShape:
    """When an unvalidated DPI is requested, the worker SHALL emit a
    `dpi-warning` event with the documented JSON shape and SHALL still
    proceed with the scan (warn-then-proceed semantics)."""

    @patch("time.sleep")
    def test_unvalidated_dpi_emits_dpi_warning_event(self, _mock_sleep, tmp_path):
        w = _make_worker()
        plate = _make_plate(tmp_path, resolution=3200)

        stdout = _capture_stdout(w._scan_plate, plate)
        events = _parse_events(stdout)

        dpi_warnings = [e for e in events if e["type"] == "dpi-warning"]
        assert len(dpi_warnings) == 1, (
            f"expected 1 dpi-warning event, got events: {events}"
        )

    @patch("time.sleep")
    def test_dpi_warning_event_has_correct_shape(self, _mock_sleep, tmp_path):
        w = _make_worker()
        plate = _make_plate(tmp_path, resolution=3200)

        stdout = _capture_stdout(w._scan_plate, plate)
        events = _parse_events(stdout)
        dpi_warnings = [e for e in events if e["type"] == "dpi-warning"]
        assert len(dpi_warnings) == 1
        evt = dpi_warnings[0]

        # Field types
        assert evt["type"] == "dpi-warning"
        assert evt["scanner_id"] == "test-scanner"
        assert isinstance(evt["requested_dpi"], int)
        assert evt["requested_dpi"] == 3200
        assert isinstance(evt["validated_set"], list)
        # Exact order per the documented shape
        assert evt["validated_set"] == [200, 400, 600, 800, 1200, 1600]
        assert isinstance(evt["timestamp"], str)
        # ISO 8601 with timezone offset
        iso_pattern = re.compile(
            r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:?\d{2}$"
        )
        assert iso_pattern.match(evt["timestamp"]), (
            f"timestamp does not match ISO 8601: {evt['timestamp']}"
        )

    @patch("time.sleep")
    def test_unvalidated_dpi_logs_warning_to_stderr(self, _mock_sleep, tmp_path):
        w = _make_worker()
        plate = _make_plate(tmp_path, resolution=3200)

        # Capture stderr to verify the warning is logged
        old_stderr = sys.stderr
        stderr_buf = io.StringIO()
        sys.stderr = stderr_buf
        try:
            _capture_stdout(w._scan_plate, plate)
        finally:
            sys.stderr = old_stderr

        stderr_text = stderr_buf.getvalue()
        assert "outside validated set" in stderr_text.lower() or "3200" in stderr_text

    @patch("time.sleep")
    def test_validated_dpi_does_not_emit_warning(self, _mock_sleep, tmp_path):
        """Standard production 1200 dpi SHALL not emit any dpi-warning."""
        w = _make_worker()
        plate = _make_plate(tmp_path, resolution=1200)

        stdout = _capture_stdout(w._scan_plate, plate)
        events = _parse_events(stdout)
        dpi_warnings = [e for e in events if e["type"] == "dpi-warning"]
        assert len(dpi_warnings) == 0

    @patch("time.sleep")
    def test_warn_then_proceed_completes_scan(self, _mock_sleep, tmp_path):
        """An unvalidated DPI SHALL warn but still proceed; in mock mode
        the scan completes successfully."""
        w = _make_worker()
        plate = _make_plate(tmp_path, resolution=3200)

        stdout = _capture_stdout(w._scan_plate, plate)
        events = _parse_events(stdout)

        # Both dpi-warning AND scan-complete should be present
        dpi_warnings = [e for e in events if e["type"] == "dpi-warning"]
        scan_completes = [e for e in events if e["type"] == "scan-complete"]
        scan_errors = [e for e in events if e["type"] == "scan-error"]

        assert len(dpi_warnings) == 1
        assert len(scan_completes) == 1, f"scan should complete, got: {events}"
        assert len(scan_errors) == 0, f"no error expected, got: {events}"
