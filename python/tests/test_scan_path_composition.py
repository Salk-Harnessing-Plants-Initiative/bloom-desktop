"""
Tests for compose_output_path(plate, et) in scan_worker — pin how the
worker builds a plate's final path from its name parts when it saves, so it
writes the file under its final name directly (no post-save rename; see
issue #154): the session folder (`output_dir`) joined with
`{exp_name}_wave{wave_number}_st_{st_timestamp}_et_{et}_cy{cycle}
_{system_prefix}{scanner_tag}_{plate_index}.tif`.
"""

import os

from python.graviscan.scan_worker import compose_output_path
from python.tests.scan_plate_parts import plate_parts

SESSION = "/tmp/scans/Exp_wave2_20260413T120530"


class TestComposeOutputPath:
    def test_joins_output_dir_and_rig_name(self):
        plate = plate_parts(
            SESSION,
            plate_index="01",
            exp_name="Exp",
            wave_number=2,
            st_timestamp="20260413T120530",
            cycle=3,
            scanner_tag="Sc2",
        )
        result = compose_output_path(plate, et="20260413T120545")
        assert result == os.path.join(
            SESSION, "Exp_wave2_st_20260413T120530_et_20260413T120545_cy3_Sc2_01.tif"
        )
        assert os.path.dirname(result) == SESSION

    def test_et_sits_right_after_the_st_time(self):
        plate = plate_parts(SESSION, st_timestamp="20260413T120530")
        name = os.path.basename(compose_output_path(plate, et="20260413T120545"))
        assert "_st_20260413T120530_et_20260413T120545_cy1_" in name

    def test_repeated_calls_give_one_et_each(self):
        """Calling compose_output_path twice on the *same* plate with
        different et values (e.g. across retries) gives two names that each
        carry exactly one `_et_` — the plate is never mutated, so segments
        cannot stack."""
        plate = plate_parts(SESSION, st_timestamp="20260413T120530")
        before = dict(plate)

        first = compose_output_path(plate, et="20260413T120545")
        second = compose_output_path(plate, et="20260413T130000")

        assert plate == before
        assert first != second
        assert first == os.path.join(
            SESSION, "scan_wave1_st_20260413T120530_et_20260413T120545_cy1_Sc1_00.tif"
        )
        assert second == os.path.join(
            SESSION, "scan_wave1_st_20260413T120530_et_20260413T130000_cy1_Sc1_00.tif"
        )
        assert first.count("_et_") == 1
        assert second.count("_et_") == 1

    def test_empty_system_prefix(self):
        plate = plate_parts(SESSION, system_prefix="")
        name = os.path.basename(compose_output_path(plate, et="20260413T120545"))
        assert name.endswith("_cy1_Sc1_00.tif")

    def test_system_prefix_comes_before_scanner_tag(self):
        plate = plate_parts(SESSION, system_prefix="graviscan-desktop_")
        name = os.path.basename(compose_output_path(plate, et="20260413T120545"))
        assert name.endswith("_cy1_graviscan-desktop_Sc1_00.tif")

    def test_experiment_name_with_date_or_cycle_is_kept_as_is(self):
        """The name is assembled from parts, not parsed — an experiment name
        that itself contains a date or `_cy1_` is not mistaken for the
        time or cycle segments."""
        for exp in ("Trial_20260301T120000", "Trial_cy1_rerun"):
            plate = plate_parts(SESSION, exp_name=exp, cycle=4)
            name = os.path.basename(compose_output_path(plate, et="20260413T120545"))
            assert name == (
                f"{exp}_wave1_st_20260301T120000_et_20260413T120545_cy4_Sc1_00.tif"
            )
            assert name.count("_et_") == 1
