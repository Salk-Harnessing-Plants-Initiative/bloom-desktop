"""Tests for python/graviscan/qr_reader.py (QR decoding from scan images).

Two tiers of coverage:

1. Synthetic-image tests (always run). Real QR codes are generated with
   ``cv2.QRCodeEncoder`` and written to disk as PNG/TIFF, then decoded back
   through the real ``decode_qr_codes()`` function. These exercise the actual
   OpenCV detect/decode path — no mocking of cv2 — without needing the large
   binary scan fixtures.
2. Fixture-gated tests against real 61MB GraviScan TIFF captures in
   ``tests/fixtures/graviscan-qr-images/``. Those images are not committed;
   these tests skip when they are absent, matching the same convention used by
   the Node-side fixture tests in ``tests/unit/qr-reader.test.ts``.
"""

import os
from pathlib import Path

import pytest

from python.graviscan.qr_reader import decode_qr_codes

# Repo root = <root>/python/tests/test_qr_reader.py -> up 3
REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_DIR = REPO_ROOT / "tests" / "fixtures" / "graviscan-qr-images"

HAS_FIXTURES = FIXTURES_DIR.is_dir() and any(FIXTURES_DIR.glob("*.tif"))


def _write_qr_image(path, payloads, scale=8, border=40):
    """Render one or more QR codes onto a single image file.

    Multiple payloads are laid out horizontally with a white gutter between
    them, mirroring how a real plate image carries several section QR codes.
    """
    import cv2
    import numpy as np

    encoder = cv2.QRCodeEncoder.create()
    tiles = []
    for payload in payloads:
        tile = encoder.encode(payload)
        tile = cv2.resize(
            tile, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST
        )
        tile = cv2.copyMakeBorder(
            tile, border, border, border, border, cv2.BORDER_CONSTANT, value=255
        )
        tiles.append(tile)

    height = max(t.shape[0] for t in tiles)
    padded = []
    for tile in tiles:
        pad = height - tile.shape[0]
        if pad:
            tile = cv2.copyMakeBorder(
                tile, 0, pad, 0, 0, cv2.BORDER_CONSTANT, value=255
            )
        padded.append(tile)

    canvas = np.hstack(padded)
    assert cv2.imwrite(str(path), canvas), f"failed to write {path}"
    return str(path)


# --- Synthetic-image tests (always run) -------------------------------------


def test_decode_single_qr_code(tmp_path):
    """A single QR code in a PNG is decoded back to its exact payload."""
    payload = "COL-0_Wave_4_Plate_13_S1_PC22_0.1uM"
    image = _write_qr_image(tmp_path / "single.png", [payload])

    assert decode_qr_codes(image) == [payload]


def test_decode_multiple_qr_codes_from_one_image(tmp_path):
    """detectAndDecodeMulti finds every QR code present on one plate image."""
    payloads = [
        "COL-0_Wave_4_Plate_11_S1",
        "COL-0_Wave_4_Plate_11_S2",
        "COL-0_Wave_4_Plate_11_S3",
        "COL-0_Wave_4_Plate_11_S4",
    ]
    image = _write_qr_image(tmp_path / "multi.png", payloads)

    assert sorted(decode_qr_codes(image)) == sorted(payloads)


def test_decode_from_tiff(tmp_path):
    """TIFF is the real scan output format — it must decode like any other."""
    payload = "COL-0_Wave_4_Plate_16_S1"
    image = _write_qr_image(tmp_path / "scan.tif", [payload])

    assert decode_qr_codes(image) == [payload]


def test_decode_image_without_qr_codes(tmp_path):
    """A valid image containing no QR codes yields an empty list, not an error."""
    import cv2
    import numpy as np

    blank = np.full((400, 400), 255, dtype=np.uint8)
    path = tmp_path / "blank.png"
    assert cv2.imwrite(str(path), blank)

    assert decode_qr_codes(str(path)) == []


def test_decode_missing_file_returns_empty_list(tmp_path):
    """A missing image must not raise — the batch continues past it."""
    assert decode_qr_codes(str(tmp_path / "does-not-exist.tif")) == []


def test_decode_unreadable_file_returns_empty_list(tmp_path):
    """A file that exists but is not a decodable image returns an empty list."""
    path = tmp_path / "not-an-image.tif"
    path.write_bytes(b"this is definitely not a TIFF")

    assert decode_qr_codes(str(path)) == []


def test_decode_directory_path_returns_empty_list(tmp_path):
    """A directory passed where a file was expected returns an empty list."""
    assert decode_qr_codes(str(tmp_path)) == []


def test_decode_handles_unexpected_cv2_error(tmp_path, monkeypatch):
    """An unexpected exception from OpenCV is caught, not propagated."""
    import cv2

    payload = "COL-0_Wave_4_Plate_13_S1"
    image = _write_qr_image(tmp_path / "boom.png", [payload])

    def explode(*_args, **_kwargs):
        raise RuntimeError("cv2 exploded")

    monkeypatch.setattr(cv2, "imread", explode)

    assert decode_qr_codes(image) == []


def test_decode_does_not_resize_the_image(tmp_path, monkeypatch):
    """Design decision 3: decode at full resolution, never downscale.

    A resize before decoding risks shrinking a QR below its scannable pixel
    threshold on a 4-QR plate image, so cv2.resize must not be called on the
    decode path.
    """
    import cv2

    called = []
    real_resize = cv2.resize

    def spy(*args, **kwargs):
        called.append(args)
        return real_resize(*args, **kwargs)

    image = _write_qr_image(tmp_path / "full-res.png", ["COL-0_Plate_13_S1"])
    monkeypatch.setattr(cv2, "resize", spy)

    decode_qr_codes(image)

    assert called == []


# --- Fixture-gated tests against real scan images ---------------------------

pytestmark_reason = f"real TIFF fixtures not present in {FIXTURES_DIR}"


@pytest.mark.skipif(not HAS_FIXTURES, reason=pytestmark_reason)
@pytest.mark.parametrize(
    "filename,expected_plate",
    [
        ("plate13_S1_00.tif", "Plate_13"),
        ("plate16_S1_11.tif", "Plate_16"),
        ("plate11_S2_10.tif", "Plate_11"),
        ("plate12_S2_11.tif", "Plate_12"),
    ],
)
def test_decode_real_scan_fixture(filename, expected_plate):
    """Real GraviScan TIFF captures decode to their expected plate ID."""
    image = FIXTURES_DIR / filename
    if not image.exists():
        pytest.skip(f"fixture {filename} not present")

    codes = decode_qr_codes(str(image))

    assert codes, f"no QR codes decoded from {filename}"
    assert any(expected_plate in c for c in codes)


@pytest.mark.skipif(not HAS_FIXTURES, reason=pytestmark_reason)
def test_decode_real_scan_fixture_finds_all_four_sections():
    """plate11_S2_10.tif carries four section QR codes (one per plate section)."""
    image = FIXTURES_DIR / "plate11_S2_10.tif"
    if not image.exists():
        pytest.skip("fixture plate11_S2_10.tif not present")

    codes = decode_qr_codes(str(image))

    assert len(codes) == 4


def test_fixtures_dir_constant_points_at_repo_fixtures():
    """Guards the repo-root path math above (parents[2]) from silent drift."""
    assert FIXTURES_DIR.parent.name == "fixtures"
    assert (REPO_ROOT / "package.json").exists()
    assert os.path.isabs(str(FIXTURES_DIR))
