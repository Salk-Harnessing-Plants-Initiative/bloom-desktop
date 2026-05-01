"""
Scan Region Configuration for GraviScan.

Defines the scan regions for 2-grid and 4-grid plate configurations.
Coordinates are in millimeters, matching the original graviscan.cfg.
"""

from dataclasses import dataclass
from typing import Dict, List


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
    "01": ScanRegion(top=5.0, left=110.0, width=110.0, height=150.0),  # Top-right
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


# Epson V600 scanner bed limits (mm)
SCANNER_MAX_X = 215.9
SCANNER_MAX_Y = 297.0


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
