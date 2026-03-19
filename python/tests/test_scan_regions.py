"""
Tests for scan_regions.py — pure logic, no mocks or hardware required.

Covers: get_scan_region, get_all_plate_indices, get_row_groups,
        get_row_bounding_box, get_crop_box, ScanRegion.to_pixels, ScanRegion.to_dict
"""

import pytest

from python.graviscan.scan_regions import (
    GRID_2_REGIONS,
    GRID_4_REGIONS,
    SCANNER_MAX_X,
    ScanRegion,
    get_all_plate_indices,
    get_crop_box,
    get_row_bounding_box,
    get_row_groups,
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
# 1.3  get_row_groups
# ---------------------------------------------------------------------------
class TestGetRowGroups:
    def test_4grid_has_two_rows(self):
        groups = get_row_groups("4grid")
        assert "top" in groups and "bottom" in groups
        assert set(groups["top"]) == {"00", "01"}
        assert set(groups["bottom"]) == {"10", "11"}

    def test_2grid_each_plate_own_row(self):
        groups = get_row_groups("2grid")
        assert groups["top"] == ["01"]
        assert groups["bottom"] == ["00"]

    def test_invalid_grid_mode(self):
        with pytest.raises(ValueError):
            get_row_groups("1grid")


# ---------------------------------------------------------------------------
# 1.4  get_row_bounding_box
# ---------------------------------------------------------------------------
class TestGetRowBoundingBox:
    def test_4grid_top_row_union(self):
        bbox = get_row_bounding_box("4grid", ["00", "01"])
        r00 = GRID_4_REGIONS["00"]
        r01 = GRID_4_REGIONS["01"]
        assert bbox.top == min(r00.top, r01.top)
        assert bbox.left == min(r00.left, r01.left)
        expected_right = min(
            max(r00.left + r00.width, r01.left + r01.width), SCANNER_MAX_X
        )
        assert bbox.width == pytest.approx(expected_right - bbox.left)

    def test_4grid_bottom_row_union(self):
        bbox = get_row_bounding_box("4grid", ["10", "11"])
        r10 = GRID_4_REGIONS["10"]
        r11 = GRID_4_REGIONS["11"]
        assert bbox.top == min(r10.top, r11.top)
        max_bottom = max(r10.top + r10.height, r11.top + r11.height)
        assert bbox.height == pytest.approx(max_bottom - bbox.top)

    def test_single_plate_bbox_matches_region(self):
        r = get_scan_region("4grid", "00")
        bbox = get_row_bounding_box("4grid", ["00"])
        assert bbox.top == r.top
        assert bbox.left == r.left
        assert bbox.width == pytest.approx(r.width)
        assert bbox.height == pytest.approx(r.height)

    def test_clamped_to_scanner_max_x(self):
        """Bounding box width should never exceed SCANNER_MAX_X."""
        bbox = get_row_bounding_box("4grid", ["00", "01"])
        assert bbox.left + bbox.width <= SCANNER_MAX_X + 0.01


# ---------------------------------------------------------------------------
# 1.5  get_crop_box
# ---------------------------------------------------------------------------
class TestGetCropBox:
    def test_crop_box_at_300dpi(self):
        bbox = get_row_bounding_box("4grid", ["00", "01"])
        crop = get_crop_box("4grid", "00", bbox, 300)
        assert len(crop) == 4
        left, upper, right, lower = crop
        assert left >= 0
        assert upper >= 0
        assert right > left
        assert lower > upper

    def test_crop_box_at_600dpi_doubles_pixels(self):
        bbox = get_row_bounding_box("4grid", ["00", "01"])
        crop300 = get_crop_box("4grid", "00", bbox, 300)
        crop600 = get_crop_box("4grid", "00", bbox, 600)
        # Each pixel value at 600 should be ~2x the 300 value
        for v300, v600 in zip(crop300, crop600):
            assert abs(v600 - 2 * v300) <= 1

    def test_first_plate_starts_near_origin(self):
        bbox = get_row_bounding_box("4grid", ["00", "01"])
        crop = get_crop_box("4grid", "00", bbox, 300)
        r00 = GRID_4_REGIONS["00"]
        # "00" left == bbox.left, so crop left should be 0
        expected_left = int((r00.left - bbox.left) * 300 / 25.4)
        assert crop[0] == expected_left


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
