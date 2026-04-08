"""
GraviScan module for Bloom Desktop.

Provides USB flatbed scanner support for graviscan experiments using:
- SANE (python-sane) on Linux via per-scanner subprocesses (scan_worker.py)
- Detection via lsusb (TypeScript, no Python needed)

Supported hardware:
- Epson Perfection V39 (vendor_id=04b8, product_id=013a)
"""

from .scan_regions import ScanRegion, get_scan_region, GRID_2_REGIONS, GRID_4_REGIONS

__all__ = [
    "ScanRegion",
    "get_scan_region",
    "GRID_2_REGIONS",
    "GRID_4_REGIONS",
]
