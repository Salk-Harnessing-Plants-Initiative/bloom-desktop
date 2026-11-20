"""
The worker builds a session scan's file name from its parts when it saves,
as the GraviScan rig does (rig scan_worker.py `compose_output_path(plate,
et)`). Golden names are real rig files backed up to Box
(GraviScan-Backups/graviscan-desktop/Perceptome_Screen/wave_20/, 2026-08-09).

Fixed while porting from the rig: `_et_` is UTC (the rig wrote station local
time), the TIFF carries the scanner's name and the full experiment name.
"""

import json
import os
import re
import time
from datetime import datetime, timezone

import pytest
from PIL import Image

from python.graviscan.scan_worker import (
    ScanWorker,
    compose_name_from_parts,
    compose_output_path,
)

RIG_GOLDEN = [
    "Perceptome_Screen_wave20_st_20260809T190946_et_20260809T121108_cy1_graviscan-desktop_Sc1_00.tif",
    "Perceptome_Screen_wave20_st_20260809T190946_et_20260809T121112_cy1_graviscan-desktop_Sc2_00.tif",
    "Perceptome_Screen_wave20_st_20260809T191127_et_20260809T121252_cy1_graviscan-desktop_Sc1_01.tif",
    "Perceptome_Screen_wave20_st_20260809T191127_et_20260809T121256_cy1_graviscan-desktop_Sc2_01.tif",
    "Perceptome_Screen_wave20_st_20260809T191311_et_20260809T121435_cy1_graviscan-desktop_Sc1_10.tif",
    "Perceptome_Screen_wave20_st_20260809T191311_et_20260809T121440_cy1_graviscan-desktop_Sc2_10.tif",
    "Perceptome_Screen_wave20_st_20260809T191455_et_20260809T121618_cy1_graviscan-desktop_Sc1_11.tif",
    "Perceptome_Screen_wave20_st_20260809T191455_et_20260809T121623_cy1_graviscan-desktop_Sc2_11.tif",
    "Perceptome_Screen_wave20_st_20260809T191646_et_20260809T121807_cy2_graviscan-desktop_Sc1_00.tif",
    "Perceptome_Screen_wave20_st_20260809T191646_et_20260809T121812_cy2_graviscan-desktop_Sc2_00.tif",
]

RIG_NAME = re.compile(
    r"^(?P<exp>.+)_wave(?P<wave>\d+)_st_(?P<st>\d{8}T\d{6})_et_(?P<et>\d{8}T\d{6})"
    r"_cy(?P<cycle>\d+)_(?P<prefix>graviscan-desktop_)(?P<tag>Sc\d+)_(?P<plate>\d{2})\.tif$"
)


def session_plate(output_dir, **overrides):
    """A session plate as Start Scan and the coordinator send it."""
    plate = {
        "plate_index": "00",
        "grid_mode": "2grid",
        "resolution": 300,
        "output_dir": str(output_dir),
        "exp_name": "Perceptome_Screen",
        "experiment_name": "Perceptome Screen",
        "wave_number": 20,
        "st_timestamp": "20260809T190946",
        "cycle": 1,
        "system_prefix": "graviscan-desktop_",
        "scanner_tag": "Sc1",
        "phenotyper_name": "Jane Doe",
        "scanner_name": "Left rear",
    }
    plate.update(overrides)
    return plate


class TestGoldenRigNames:
    @pytest.mark.parametrize("golden", RIG_GOLDEN)
    def test_builds_the_real_rig_name_from_its_parts(self, golden):
        m = RIG_NAME.match(golden)
        assert m
        parts = {
            "exp_name": m["exp"],
            "wave_number": int(m["wave"]),
            "st_timestamp": m["st"],
            "cycle": int(m["cycle"]),
            "system_prefix": m["prefix"],
            "scanner_tag": m["tag"],
            "plate_index": m["plate"],
        }
        assert compose_name_from_parts(parts, m["et"]) == golden

    def test_no_system_name(self):
        parts = {
            "exp_name": "Trial_cy1",
            "wave_number": 1,
            "st_timestamp": "20260810T080000",
            "cycle": 3,
            "system_prefix": "",
            "scanner_tag": "Sc1",
            "plate_index": "01",
        }
        assert (
            compose_name_from_parts(parts, "20260810T080500")
            == "Trial_cy1_wave1_st_20260810T080000_et_20260810T080500_cy3_Sc1_01.tif"
        )


class TestComposeOutputPathWithParts:
    def test_parts_build_the_path_in_the_session_folder(self):
        plate = session_plate("/scans/Perceptome_Screen_wave20_20260809T190946")
        assert compose_output_path(plate, "20260809T191108") == os.path.join(
            "/scans/Perceptome_Screen_wave20_20260809T190946",
            "Perceptome_Screen_wave20_st_20260809T190946_et_20260809T191108"
            "_cy1_graviscan-desktop_Sc1_00.tif",
        )

    def test_a_plate_without_its_parts_is_refused(self):
        """There is no ready-path mode: every plate must carry its name
        parts, starting with the session folder."""
        plate = session_plate("/scans/x")
        del plate["output_dir"]
        with pytest.raises(KeyError, match="output_dir"):
            compose_output_path(plate, "20260809T191108")


@pytest.fixture
def pacific_time(monkeypatch):
    """Run as a station in Pacific time, where local and UTC differ."""
    monkeypatch.setenv("TZ", "America/Los_Angeles")
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


class TestSessionScanSave:
    def scan(self, tmp_path, capsys, **overrides):
        worker = ScanWorker(scanner_id="scanner-1", device_name="mock", mock=True)
        worker._scan_plate(session_plate(tmp_path, **overrides))
        events = [
            json.loads(line[len("EVENT:") :])
            for line in capsys.readouterr().out.splitlines()
            if line.startswith("EVENT:")
        ]
        complete = [e for e in events if e["type"] == "scan-complete"]
        assert len(complete) == 1, events
        return complete[0]["path"]

    def test_saves_under_the_rig_name(self, tmp_path, capsys):
        saved = self.scan(tmp_path, capsys)
        assert os.path.dirname(saved) == str(tmp_path)
        assert os.path.exists(saved)
        assert re.match(
            r"^Perceptome_Screen_wave20_st_20260809T190946_et_\d{8}T\d{6}"
            r"_cy1_graviscan-desktop_Sc1_00\.tif$",
            os.path.basename(saved),
        )

    def test_et_is_utc_not_station_local_time(self, tmp_path, capsys, pacific_time):
        before = datetime.now(timezone.utc).replace(microsecond=0, tzinfo=None)
        saved = self.scan(tmp_path, capsys)
        after = datetime.now(timezone.utc).replace(tzinfo=None)
        et = re.search(r"_et_(\d{8}T\d{6})_", os.path.basename(saved)).group(1)
        et_time = datetime.strptime(et, "%Y%m%dT%H%M%S")
        assert before <= et_time <= after

    def test_tiff_has_full_experiment_name_phenotyper_and_scanner_name(
        self, tmp_path, capsys
    ):
        saved = self.scan(tmp_path, capsys)
        desc = json.loads(Image.open(saved).tag_v2[270])
        assert desc["exp_name"] == "Perceptome Screen"
        assert desc["phenotyper_name"] == "Jane Doe"
        assert desc["scanner_name"] == "Left rear"
        assert desc["scanner_id"] == "scanner-1"
        assert desc["wave_number"] == 20
        assert desc["st_timestamp"] == "20260809T190946"

    def test_long_experiment_name_is_kept_whole_in_the_tiff(self, tmp_path, capsys):
        full = "Perceptome Screen with a much longer name"
        saved = self.scan(tmp_path, capsys, experiment_name=full)
        desc = json.loads(Image.open(saved).tag_v2[270])
        assert desc["exp_name"] == full
        assert os.path.basename(saved).startswith("Perceptome_Screen_wave20_")
