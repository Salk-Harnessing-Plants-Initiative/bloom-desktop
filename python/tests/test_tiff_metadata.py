"""Tests for TIFF metadata embedding in scan images."""

import json
import os
import tempfile

from PIL import Image

from python.graviscan.scan_worker import ScanWorker, _build_tiff_metadata
from python.graviscan.scan_regions import get_scan_region


class TestBuildTiffMetadata:
    """Test the _build_tiff_metadata helper."""

    def test_returns_ifd_with_standard_tags(self):
        region = get_scan_region("2grid", "00")
        ifd = _build_tiff_metadata("scanner-001", "2grid", "00", 300, region)

        # ImageDescription (270) — JSON string
        desc = json.loads(ifd[270])
        assert desc["scanner_id"] == "scanner-001"
        assert desc["grid_mode"] == "2grid"
        assert desc["plate_index"] == "00"
        assert desc["resolution_dpi"] == 300
        assert "scan_region_mm" in desc
        assert desc["scan_region_mm"]["top"] == region.top
        assert desc["scan_region_mm"]["left"] == region.left
        assert desc["scan_region_mm"]["width"] == region.width
        assert desc["scan_region_mm"]["height"] == region.height
        assert "capture_timestamp" in desc
        assert "bloom_version" in desc

        # Software (305)
        assert ifd[305] == "Bloom Desktop / GraviScan"

        # Resolution tags
        assert float(ifd[282]) == 300.0  # XResolution
        assert float(ifd[283]) == 300.0  # YResolution
        assert ifd[296] == 2  # ResolutionUnit = inches

        # DateTime (306)
        assert len(ifd[306]) == 19  # "YYYY:MM:DD HH:MM:SS"


class TestMockScanTiffMetadata:
    """Test that mock scans produce TIFFs with embedded metadata."""

    def test_mock_scan_embeds_metadata(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = os.path.join(tmpdir, "scan.tif")

            worker = ScanWorker(
                scanner_id="test-scanner", device_name="mock", mock=True
            )
            worker._mock_scan("2grid", "00", 300, output_path)

            # Read TIFF and check tags
            img = Image.open(output_path)
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

    def test_mock_scan_different_grid_modes(self):
        """Verify metadata reflects the actual grid mode and plate index."""
        with tempfile.TemporaryDirectory() as tmpdir:
            for grid_mode, plate_index in [("2grid", "01"), ("4grid", "10")]:
                output_path = os.path.join(
                    tmpdir, f"scan_{grid_mode}_{plate_index}.tif"
                )

                worker = ScanWorker(
                    scanner_id="test-scanner", device_name="mock", mock=True
                )
                worker._mock_scan(grid_mode, plate_index, 600, output_path)

                img = Image.open(output_path)
                desc = json.loads(img.tag_v2[270])
                assert desc["grid_mode"] == grid_mode
                assert desc["plate_index"] == plate_index
                assert desc["resolution_dpi"] == 600
