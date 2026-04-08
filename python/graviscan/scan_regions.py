"""
Scan Region Configuration for GraviScan.

Defines the scan regions for 2-grid and 4-grid plate configurations.
Coordinates are in millimeters, matching the original graviscan.cfg.
"""

from dataclasses import dataclass
from typing import Dict, List, Tuple


@dataclass
class ScanRegion:
    """Scan region coordinates in millimeters.

    Attributes:
        top: Distance from top edge of scanner bed (mm)
        left: Distance from left edge of scanner bed (mm)
        width: Width of scan region (mm)
        height: Height of scan region (mm)
    """

    top: float
    left: float
    width: float
    height: float

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "top": self.top,
            "left": self.left,
            "width": self.width,
            "height": self.height,
        }

    def to_pixels(self, dpi: int) -> dict:
        """Convert millimeters to pixels at given DPI.

        Args:
            dpi: Scan resolution in dots per inch

        Returns:
            Dictionary with top, left, width, height in pixels
        """
        mm_per_inch = 25.4
        pixels_per_mm = dpi / mm_per_inch

        return {
            "top": int(self.top * pixels_per_mm),
            "left": int(self.left * pixels_per_mm),
            "width": int(self.width * pixels_per_mm),
            "height": int(self.height * pixels_per_mm),
        }


# 2-Grid Plate Regions (from graviscan.cfg)
# Two vertical plates on the scanner bed
GRID_2_REGIONS: Dict[str, ScanRegion] = {
    "00": ScanRegion(top=150.0, left=40.0, width=140.0, height=140.0),  # Bottom plate
    "01": ScanRegion(top=5.0, left=40.0, width=140.0, height=140.0),  # Top plate
}

# 4-Grid Plate Regions (from graviscan.cfg)
# Four plates in a 2x2 grid on the scanner bed
GRID_4_REGIONS: Dict[str, ScanRegion] = {
    "00": ScanRegion(top=10.0, left=5.0, width=105.0, height=145.0),  # Top-left
    "01": ScanRegion(
        top=5.0, left=110.0, width=105.9, height=150.0
    ),  # Top-right (clamped to bed width 215.9mm)
    "10": ScanRegion(top=151.0, left=5.0, width=105.0, height=145.0),  # Bottom-left
    "11": ScanRegion(top=151.0, left=115.0, width=105.0, height=145.0),  # Bottom-right
}


def get_scan_region(grid_mode: str, plate_index: str) -> ScanRegion:
    """Get the scan region for a specific grid mode and plate index.

    Args:
        grid_mode: Either "2grid" or "4grid"
        plate_index: Plate position:
            - For 2grid: "00" (bottom) or "01" (top)
            - For 4grid: "00" (top-left), "01" (top-right),
                        "10" (bottom-left), "11" (bottom-right)

    Returns:
        ScanRegion with coordinates in millimeters

    Raises:
        ValueError: If grid_mode or plate_index is invalid
    """
    if grid_mode == "2grid":
        if plate_index not in GRID_2_REGIONS:
            raise ValueError(
                f"Invalid plate_index '{plate_index}' for 2grid. "
                f"Must be one of: {list(GRID_2_REGIONS.keys())}"
            )
        return GRID_2_REGIONS[plate_index]

    elif grid_mode == "4grid":
        if plate_index not in GRID_4_REGIONS:
            raise ValueError(
                f"Invalid plate_index '{plate_index}' for 4grid. "
                f"Must be one of: {list(GRID_4_REGIONS.keys())}"
            )
        return GRID_4_REGIONS[plate_index]

    else:
        raise ValueError(
            f"Invalid grid_mode '{grid_mode}'. Must be '2grid' or '4grid'."
        )


# Epson Perfection V39 scanner bed limits (mm) — A4 scan area
SCANNER_MAX_X = 215.9
SCANNER_MAX_Y = 297.0

# Row groupings for 4-grid mode (grids sharing the same vertical range)
GRID_4_ROW_GROUPS: Dict[str, List[str]] = {
    "top": ["00", "01"],
    "bottom": ["10", "11"],
}


def get_row_groups(grid_mode: str) -> Dict[str, List[str]]:
    """Get row groupings for a grid mode.

    For 4grid, grids are grouped by row (same vertical range).
    For 2grid, each plate is its own group (different vertical positions).

    Returns:
        Dict mapping row name to list of plate indices.
    """
    if grid_mode == "4grid":
        return GRID_4_ROW_GROUPS
    elif grid_mode == "2grid":
        # 2grid plates are at different vertical positions — no row merge
        return {"top": ["01"], "bottom": ["00"]}
    else:
        raise ValueError(f"Invalid grid_mode '{grid_mode}'.")


def get_row_bounding_box(grid_mode: str, plate_indices: List[str]) -> ScanRegion:
    """Compute the bounding box covering all plates in a row group.

    Args:
        grid_mode: "2grid" or "4grid"
        plate_indices: List of plate indices in the row (e.g. ["00", "01"])

    Returns:
        ScanRegion covering the union of all specified plates,
        clamped to scanner max width.
    """
    regions = [get_scan_region(grid_mode, idx) for idx in plate_indices]

    min_top = min(r.top for r in regions)
    min_left = min(r.left for r in regions)
    max_bottom = max(r.top + r.height for r in regions)
    max_right = min(max(r.left + r.width for r in regions), SCANNER_MAX_X)

    return ScanRegion(
        top=min_top,
        left=min_left,
        width=max_right - min_left,
        height=max_bottom - min_top,
    )


def get_crop_box(
    grid_mode: str,
    plate_index: str,
    bbox: ScanRegion,
    dpi: int,
) -> Tuple[int, int, int, int]:
    """Get PIL crop box for a plate relative to the row bounding box.

    Args:
        grid_mode: "2grid" or "4grid"
        plate_index: The plate to crop (e.g. "00")
        bbox: The row bounding box that was scanned
        dpi: Scan resolution in DPI

    Returns:
        (left, upper, right, lower) in pixels for PIL Image.crop()
    """
    region = get_scan_region(grid_mode, plate_index)
    mm_per_inch = 25.4
    px_per_mm = dpi / mm_per_inch

    # Plate position relative to bounding box origin
    left = int((region.left - bbox.left) * px_per_mm)
    upper = int((region.top - bbox.top) * px_per_mm)
    right = int((region.left - bbox.left + region.width) * px_per_mm)
    lower = int((region.top - bbox.top + region.height) * px_per_mm)

    return (left, upper, right, lower)


def get_all_plate_indices(grid_mode: str) -> list:
    """Get all valid plate indices for a grid mode.

    Args:
        grid_mode: Either "2grid" or "4grid"

    Returns:
        List of valid plate index strings

    Raises:
        ValueError: If grid_mode is invalid
    """
    if grid_mode == "2grid":
        return list(GRID_2_REGIONS.keys())
    elif grid_mode == "4grid":
        return list(GRID_4_REGIONS.keys())
    else:
        raise ValueError(
            f"Invalid grid_mode '{grid_mode}'. Must be '2grid' or '4grid'."
        )
