"""
Tests for compose_output_path() in scan_worker — pin the `_et_` insertion
behavior the worker relies on to write files with their final filename
directly (no post-save rename). See issue #154.
"""

import os

from python.graviscan.scan_worker import compose_output_path


class TestComposeOutputPath:
    def test_et_inserted_right_after_st(self):
        output_path = "/tmp/scans/plate_st_20260413T120530_cy1_S1_00.tif"
        result = compose_output_path(output_path, et="20260413T120545")
        assert result == (
            "/tmp/scans/plate_st_20260413T120530_et_20260413T120545_cy1_S1_00.tif"
        )

    def test_suffix_and_extension_preserved(self):
        """The _cy/scanner-tag/plate-index suffix and file extension are
        unchanged — only the _et_ segment is inserted after _st_."""
        output_path = "/tmp/scans/exp_wave2_st_20260301T120000_cy3_GS1_Sc2_01.tif"
        result = compose_output_path(output_path, et="20260301T120530")
        assert result.endswith("_cy3_GS1_Sc2_01.tif")
        assert os.path.dirname(result) == os.path.dirname(output_path)

    def test_no_st_pattern_returned_unchanged(self):
        """Documented fallback behavior: if no _st_ pattern is found, the
        path is returned unchanged."""
        output_path = "/tmp/scans/scan.tif"
        result = compose_output_path(output_path, et="20260301T120530")
        assert result == output_path

    def test_repeated_calls_do_not_double_insert(self):
        """Calling compose_output_path twice with different et values on the
        *same original* input each produce a single, correctly-inserted
        result — no accidental double-insertion. This pins that count=1 in
        the underlying regex prevents stacking _et_ segments across retries."""
        output_path = "/tmp/scans/plate_st_20260413T120530_cy1_S1_00.tif"

        first = compose_output_path(output_path, et="20260413T120545")
        second = compose_output_path(output_path, et="20260413T130000")

        assert first != second
        assert first == (
            "/tmp/scans/plate_st_20260413T120530_et_20260413T120545_cy1_S1_00.tif"
        )
        assert second == (
            "/tmp/scans/plate_st_20260413T120530_et_20260413T130000_cy1_S1_00.tif"
        )
        # Neither result contains more than one _et_ segment.
        assert first.count("_et_") == 1
        assert second.count("_et_") == 1
