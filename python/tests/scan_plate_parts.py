"""Shared test helper: a GraviScan plate carrying the name parts the scan
worker builds every file name from (see `compose_name_from_parts`)."""

import os
import re
from typing import Any, Union

# A saved scan's base name with the default parts below, any `_et_`.
DEFAULT_SAVED_NAME = re.compile(
    r"^scan_wave1_st_20260301T120000_et_\d{8}T\d{6}_cy1_Sc1_(?P<plate>\d{2})\.tif$"
)


def plate_parts(
    output_dir: Union[str, "os.PathLike[str]"],
    plate_index: str = "00",
    grid_mode: str = "2grid",
    resolution: int = 300,
    **overrides: Any,
) -> dict:
    """A plate as the coordinator sends it, with sensible defaults.

    Any field can be overridden by keyword (e.g. `exp_name="Exp"`,
    `system_prefix="graviscan-desktop_"`, `cycle=3`).
    """
    plate = {
        "plate_index": plate_index,
        "grid_mode": grid_mode,
        "resolution": resolution,
        "output_dir": str(output_dir),
        "exp_name": "scan",
        "wave_number": 1,
        "st_timestamp": "20260301T120000",
        "cycle": 1,
        "system_prefix": "",
        "scanner_tag": "Sc1",
    }
    plate.update(overrides)
    return plate
