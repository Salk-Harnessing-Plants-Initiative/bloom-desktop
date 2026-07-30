"""QR code decoding from GraviScan plate scan images.

Used by the ``graviscan:verify-plates`` pipeline in the Electron main process:
after a scan session completes, every captured plate image is handed to this
module (via ``main.py --decode-qr-batch``) so the decoded section QR codes can
be matched against the plate the operator assigned to that scanner position.

Design notes (see docs/superpowers/specs/2026-07-29-verify-plates-qr-decode-design.md):

* OpenCV (``cv2.QRCodeDetector``) is used rather than a Node/WASM zbar binding.
  It removes both an Electron bundling hazard (the ``.wasm`` payload was never
  copied into the webpack output) and an LGPL copyleft dependency from an
  otherwise BSD-2-Clause application.
* Images are decoded at **full resolution with no resize**. A plate image can
  carry four separate section QR codes; downscaling risks shrinking one below
  its scannable pixel threshold.
* A decode failure for one image yields an empty list rather than an
  exception, so one unreadable image never aborts a whole batch.

All diagnostics go to stderr — stdout is reserved for the JSON protocol used by
``main.py --decode-qr-batch``.
"""

from __future__ import annotations

import os
import sys


def _warn(message: str) -> None:
    """Log to stderr. stdout carries the batch-mode JSON payload."""
    print(f"[qr_reader] {message}", file=sys.stderr)


def decode_qr_codes(image_path: str) -> list[str]:
    """Decode every QR code present in one scan image.

    Args:
        image_path: Absolute path to a scan image (TIFF, PNG, JPEG, ...).

    Returns:
        The decoded QR payload strings, in the order OpenCV reports them.
        Empty payloads (detected but undecodable symbols) are dropped.
        Returns an empty list — never raises — when the file is missing,
        unreadable, contains no QR codes, or the decode fails for any reason.
    """
    if not os.path.isfile(image_path):
        _warn(f"image not found: {image_path}")
        return []

    try:
        import cv2
    except ImportError as exc:  # pragma: no cover - dependency is declared
        _warn(f"OpenCV unavailable, cannot decode QR codes: {exc}")
        return []

    try:
        import numpy as np

        # Read the bytes with Python rather than letting cv2.imread open the
        # file itself. imread takes a const char* and on Windows hands it to
        # the ANSI file API, so a path containing any non-ASCII character
        # simply fails to open — the plate then comes back with no QR codes
        # and is misclassified `unreadable`, with only a cv2 warning on stderr
        # to show for it. Python's open() handles Unicode paths everywhere.
        with open(image_path, "rb") as handle:
            payload = np.frombuffer(handle.read(), dtype=np.uint8)

        # Full resolution, no resize — see module docstring.
        image = cv2.imdecode(payload, cv2.IMREAD_GRAYSCALE)
        if image is None:
            _warn(f"could not decode image data: {image_path}")
            return []

        detector = cv2.QRCodeDetector()
        found, decoded, _points, _straight = detector.detectAndDecodeMulti(image)
        if not found:
            return []

        codes = [text for text in decoded if text]
        _warn(f"{len(codes)} code(s) from {os.path.basename(image_path)}")
        return codes
    except Exception as exc:  # noqa: BLE001 - one bad image must not abort a batch
        _warn(f"error reading {os.path.basename(image_path)}: {exc}")
        return []


def decode_qr_batch(image_paths: list[str]) -> list[dict]:
    """Decode a list of images, one result entry per input path.

    Args:
        image_paths: Absolute paths to scan images.

    Returns:
        ``[{"path": <input path>, "codes": [<decoded strings>]}, ...]`` in the
        same order as ``image_paths``. Paths that fail to decode appear with an
        empty ``codes`` list rather than being omitted, so the caller can always
        zip results back onto its inputs positionally.
    """
    return [{"path": p, "codes": decode_qr_codes(p)} for p in image_paths]
