"""
Tests for scan_regions.py — pure logic, no mocks or hardware required.

Covers: get_scan_region, get_all_plate_indices, ScanRegion.to_pixels, ScanRegion.to_dict

Note: Row-merge functions (get_row_groups, get_row_bounding_box, get_crop_box) removed.
Their test classes below are skipped.
"""

import pytest

from python.graviscan.scan_regions import (
    GRID_2_REGIONS,
    GRID_4_REGIONS,
    ScanRegion,
    get_all_plate_indices,
    get_scan_region,
)


# ---------------------------------------------------------------------------
# 1.1  get_scan_region
# ---------------------------------------------------------------------------
class TestGetScanRegion:
    def test_2grid_valid_indices(self):
        r00 = get_scan_region("2grid", "00")
        r01 = get_scan_region("2grid", "01")
        assert r00 == GRID_2_REGIONS["00"]
        assert r01 == GRID_2_REGIONS["01"]

    def test_4grid_valid_indices(self):
        for idx in ("00", "01", "10", "11"):
            assert get_scan_region("4grid", idx) == GRID_4_REGIONS[idx]

    def test_invalid_grid_mode(self):
        with pytest.raises(ValueError, match="Invalid grid_mode"):
            get_scan_region("6grid", "00")

    def test_invalid_plate_index_2grid(self):
        with pytest.raises(ValueError, match="Invalid plate_index"):
            get_scan_region("2grid", "10")

    def test_invalid_plate_index_4grid(self):
        with pytest.raises(ValueError, match="Invalid plate_index"):
            get_scan_region("4grid", "99")


# ---------------------------------------------------------------------------
# 1.2  get_all_plate_indices
# ---------------------------------------------------------------------------
class TestGetAllPlateIndices:
    def test_2grid_returns_two(self):
        indices = get_all_plate_indices("2grid")
        assert set(indices) == {"00", "01"}

    def test_4grid_returns_four(self):
        indices = get_all_plate_indices("4grid")
        assert set(indices) == {"00", "01", "10", "11"}

    def test_invalid_grid_mode(self):
        with pytest.raises(ValueError):
            get_all_plate_indices("8grid")


# ---------------------------------------------------------------------------
# 1.6  ScanRegion.to_pixels
# ---------------------------------------------------------------------------
class TestScanRegionToPixels:
    def test_known_conversion(self):
        r = ScanRegion(top=25.4, left=25.4, width=25.4, height=25.4)
        px = r.to_pixels(300)
        # 25.4mm at 300dpi = exactly 300px
        assert px["top"] == 300
        assert px["left"] == 300
        assert px["width"] == 300
        assert px["height"] == 300

    def test_zero_values(self):
        r = ScanRegion(top=0, left=0, width=0, height=0)
        px = r.to_pixels(300)
        assert all(v == 0 for v in px.values())

    def test_higher_dpi_scales(self):
        r = ScanRegion(top=10.0, left=10.0, width=50.0, height=50.0)
        px300 = r.to_pixels(300)
        px600 = r.to_pixels(600)
        for key in ("top", "left", "width", "height"):
            assert abs(px600[key] - 2 * px300[key]) <= 1


# ---------------------------------------------------------------------------
# 1.7  ScanRegion.to_dict
# ---------------------------------------------------------------------------
class TestScanRegionToDict:
    def test_round_trip(self):
        r = ScanRegion(top=1.5, left=2.5, width=100.0, height=200.0)
        d = r.to_dict()
        assert d == {"top": 1.5, "left": 2.5, "width": 100.0, "height": 200.0}
        r2 = ScanRegion(**d)
        assert r2 == r

    def test_keys_present(self):
        r = ScanRegion(top=0, left=0, width=0, height=0)
        assert set(r.to_dict().keys()) == {"top", "left", "width", "height"}
