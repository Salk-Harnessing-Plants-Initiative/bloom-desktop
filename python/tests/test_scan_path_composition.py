"""
Tests for compose_output_path() in scan_worker — pin the filename pattern
the worker writes at save time. The TS coordinator and renderer pass
components only; this is the single place the final filename is built.
"""

import os
import re

from python.graviscan.scan_worker import compose_output_path


def _plate(**overrides) -> dict:
    """Component-shaped plate with sensible defaults."""
    base = {
        "plate_index": "001",
        "grid_mode": "2grid",
        "resolution": 1200,
        "output_dir": "/tmp/expA_wave2_20260301T120000",
        "exp_name": "expA",
        "st_timestamp": "20260301T120000",
        "wave_number": 2,
        "scanner_tag": "Sc1",
        "system_prefix": "",
        "cycle": 1,
    }
    base.update(overrides)
    return base


class TestComposeOutputPath:
    def test_cycle_1_baseline(self):
        path = compose_output_path(_plate(), et="20260301T120530")
        assert path == (
            "/tmp/expA_wave2_20260301T120000/"
            "expA_wave2_st_20260301T120000_et_20260301T120530"
            "_cy1_Sc1_001.tif"
        )

    def test_cycle_changes_only_cycle_segment(self):
        et = "20260301T120530"
        c1 = compose_output_path(_plate(cycle=1), et=et)
        c2 = compose_output_path(_plate(cycle=2), et=et)
        c3 = compose_output_path(_plate(cycle=3), et=et)

        # Only the cy{N} segment differs between cycles.
        assert "_cy1_" in c1 and "_cy2_" not in c1
        assert "_cy2_" in c2 and "_cy3_" not in c2
        assert "_cy3_" in c3 and "_cy1_" not in c3
        # Folder portion is identical across cycles.
        assert os.path.dirname(c1) == os.path.dirname(c2) == os.path.dirname(c3)

    def test_wave_number_embedded(self):
        for wave in (0, 1, 7, 42):
            path = compose_output_path(_plate(wave_number=wave), et="ET")
            assert f"_wave{wave}_" in os.path.basename(path)

    def test_et_segment_embedded_with_provided_value(self):
        path = compose_output_path(_plate(), et="20260301T120545")
        assert "_st_20260301T120000_et_20260301T120545_" in os.path.basename(path)

    def test_system_prefix_precedes_scanner_tag(self):
        path = compose_output_path(
            _plate(system_prefix="GS1_", scanner_tag="Sc2"),
            et="ET",
        )
        assert "_cy1_GS1_Sc2_" in os.path.basename(path)

    def test_no_system_prefix_yields_clean_scanner_tag(self):
        path = compose_output_path(
            _plate(system_prefix="", scanner_tag="Sc1"),
            et="ET",
        )
        # No leading underscore from an empty prefix.
        assert "_cy1_Sc1_" in os.path.basename(path)
        assert "_cy1__Sc1_" not in os.path.basename(path)

    def test_output_dir_used_verbatim(self):
        path = compose_output_path(
            _plate(output_dir="/scans/expA_wave2_20260301T120000"),
            et="ET",
        )
        assert path.startswith("/scans/expA_wave2_20260301T120000/")

    def test_filename_matches_expected_segment_order(self):
        """Pin the segment order: exp _ wave _ st _ et _ cy _ [prefix]tag _ plate.tif."""
        path = compose_output_path(_plate(), et="20260301T120530")
        basename = os.path.basename(path)
        pattern = re.compile(
            r"^expA_wave2_st_20260301T120000_et_20260301T120530" r"_cy1_Sc1_001\.tif$"
        )
        assert pattern.match(basename), basename
