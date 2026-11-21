"""Tests for TIFF metadata embedding in scan images."""

import json
import os
import tempfile

from PIL import Image

from python.graviscan.scan_worker import ScanWorker, _build_tiff_metadata
from python.graviscan.scan_regions import get_scan_region
from python.tests.scan_plate_parts import plate_parts


class TestBuildTiffMetadata:
    """Test the _build_tiff_metadata helper."""

    def test_records_requested_and_applied_resolution(self):
        """#508: both values are in the description; the resolution tags
        are the applied value, since the pixels are at that resolution."""
        region = get_scan_region("2grid", "00")
        ifd = _build_tiff_metadata(
            "scanner-001", "2grid", "00", 1199, region, requested_resolution=1200
        )
        desc = json.loads(ifd[270])
        assert desc["resolution_dpi"] == 1199
        assert desc["requested_resolution_dpi"] == 1200
        assert float(ifd[282]) == 1199.0
        assert float(ifd[283]) == 1199.0

    def test_returns_ifd_with_standard_tags(self):
        region = get_scan_region("2grid", "00")
        ifd = _build_tiff_metadata("scanner-001", "2grid", "00", 300, region)

        # ImageDescription (270) — JSON string
        desc = json.loads(ifd[270])
        assert desc["scanner_id"] == "scanner-001"
        assert desc["grid_mode"] == "2grid"
        assert desc["plate_index"] == "00"
        assert desc["resolution_dpi"] == 300
        # Requested defaults to the applied resolution (#508).
        assert desc["requested_resolution_dpi"] == 300
        assert "scan_region_mm" in desc
        assert desc["scan_region_mm"]["top"] == region.top
        assert desc["scan_region_mm"]["left"] == region.left
        assert desc["scan_region_mm"]["width"] == region.width
        assert desc["scan_region_mm"]["height"] == region.height
        assert "capture_timestamp" in desc
        assert "bloom_version" in desc

        # New embedded fields default when omitted
        assert desc["exp_name"] == ""
        assert desc["wave_number"] == 0
        assert desc["st_timestamp"] == ""
        assert desc["phenotyper_name"] == ""

        # Software (305)
        assert ifd[305] == "Bloom Desktop / GraviScan"

        # Resolution tags
        assert float(ifd[282]) == 300.0  # XResolution
        assert float(ifd[283]) == 300.0  # YResolution
        assert ifd[296] == 2  # ResolutionUnit = inches

        # DateTime (306)
        assert len(ifd[306]) == 19  # "YYYY:MM:DD HH:MM:SS"

    def test_embeds_new_fields_when_supplied(self):
        region = get_scan_region("2grid", "00")
        ifd = _build_tiff_metadata(
            "scanner-001",
            "2grid",
            "00",
            300,
            region,
            exp_name="exp",
            wave_number=1,
            st_timestamp="20260301T120000",
            phenotyper_name="Alice",
        )
        desc = json.loads(ifd[270])
        assert desc["exp_name"] == "exp"
        assert desc["wave_number"] == 1
        assert desc["st_timestamp"] == "20260301T120000"
        assert desc["phenotyper_name"] == "Alice"


class TestMockScanTiffMetadata:
    """Test that mock scans produce TIFFs with embedded metadata."""

    def test_mock_scan_embeds_metadata(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            plate = plate_parts(tmpdir)

            worker = ScanWorker(
                scanner_id="test-scanner", device_name="mock", mock=True
            )
            final_path = worker._mock_scan("2grid", "00", 300, plate)

            # Read TIFF and check tags — read from the path _mock_scan
            # actually returned (output_dir + the _et_-stamped rig name).
            assert os.path.dirname(final_path) == tmpdir
            assert "_et_" in os.path.basename(final_path)
            img = Image.open(final_path)
            tag_data = img.tag_v2

            # ImageDescription
            assert 270 in tag_data
            desc = json.loads(tag_data[270])
            assert desc["scanner_id"] == "test-scanner"
            assert desc["grid_mode"] == "2grid"
            assert desc["plate_index"] == "00"
            assert desc["resolution_dpi"] == 300

            # Software
            assert 305 in tag_data
            assert tag_data[305] == "Bloom Desktop / GraviScan"

            # Resolution
            assert 282 in tag_data  # XResolution
            assert 283 in tag_data  # YResolution

            # DateTime
            assert 306 in tag_data

    def test_mock_scan_embeds_new_fields(self):
        """Round-trip: write a TIFF via _mock_scan, read it back, and
        confirm exp_name/wave_number/st_timestamp/phenotyper_name are
        embedded correctly when supplied."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plate = plate_parts(tmpdir)

            worker = ScanWorker(
                scanner_id="test-scanner", device_name="mock", mock=True
            )
            final_path = worker._mock_scan(
                "2grid",
                "00",
                300,
                plate,
                "myexp",
                4,
                "20260301T120000",
                "Alice",
            )

            img = Image.open(final_path)
            desc = json.loads(img.tag_v2[270])
            assert desc["exp_name"] == "myexp"
            assert desc["wave_number"] == 4
            assert desc["st_timestamp"] == "20260301T120000"
            assert desc["phenotyper_name"] == "Alice"

    def test_mock_scan_new_fields_default_when_omitted(self):
        """Round-trip: when the caller omits the new fields, they default
        to empty/zero in the decoded ImageDescription JSON."""
        with tempfile.TemporaryDirectory() as tmpdir:
            plate = plate_parts(tmpdir)

            worker = ScanWorker(
                scanner_id="test-scanner", device_name="mock", mock=True
            )
            final_path = worker._mock_scan("2grid", "00", 300, plate)

            img = Image.open(final_path)
            desc = json.loads(img.tag_v2[270])
            assert desc["exp_name"] == ""
            assert desc["wave_number"] == 0
            assert desc["st_timestamp"] == ""
            assert desc["phenotyper_name"] == ""

    def test_mock_scan_different_grid_modes(self):
        """Verify metadata reflects the actual grid mode and plate index."""
        with tempfile.TemporaryDirectory() as tmpdir:
            for grid_mode, plate_index in [("2grid", "01"), ("4grid", "10")]:
                plate = plate_parts(
                    tmpdir,
                    plate_index=plate_index,
                    grid_mode=grid_mode,
                    resolution=600,
                    exp_name=f"scan_{grid_mode}",
                )

                worker = ScanWorker(
                    scanner_id="test-scanner", device_name="mock", mock=True
                )
                final_path = worker._mock_scan(grid_mode, plate_index, 600, plate)

                img = Image.open(final_path)
                desc = json.loads(img.tag_v2[270])
                assert desc["grid_mode"] == grid_mode
                assert desc["plate_index"] == plate_index
                assert desc["resolution_dpi"] == 600
                assert desc["requested_resolution_dpi"] == 600
