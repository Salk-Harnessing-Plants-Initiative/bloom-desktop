#!/usr/bin/env python3
"""Repair metadata.csv by adding a file_path column with the actual on-disk filename.

The image_filename column has partial names (missing _et_ end timestamp).
This script matches each row to the actual renamed file in the same directory
and adds a file_path column with the correct filename.

Usage:
    python scripts/fix-metadata-filepath.py <path-to-metadata.csv>

The corrected CSV is written in-place (original backed up as metadata.csv.bak).
"""

import csv
import os
import re
import shutil
import sys


def build_file_index(directory: str) -> dict[str, str]:
    """Index all .tif files by their _st_ prefix + _cy suffix (without _et_)."""
    index: dict[str, str] = {}
    for fname in os.listdir(directory):
        if not fname.lower().endswith((".tif", ".tiff")):
            continue
        # Strip out _et_YYYYMMDDTHHMMSS to get the lookup key
        key = re.sub(r"_et_\d{8}T\d{6}", "", fname)
        index[key] = fname
    return index


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python fix-metadata-filepath.py <path-to-metadata.csv>")
        sys.exit(1)

    csv_path = sys.argv[1]
    if not os.path.isfile(csv_path):
        print(f"File not found: {csv_path}")
        sys.exit(1)

    directory = os.path.dirname(os.path.abspath(csv_path))
    file_index = build_file_index(directory)
    print(f"Indexed {len(file_index)} image files in {directory}")

    # Read original CSV
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)

    # Add file_path column after image_filename
    if "file_path" not in fieldnames:
        idx = fieldnames.index("image_filename") + 1
        fieldnames.insert(idx, "file_path")

    matched = 0
    unmatched = 0
    for row in rows:
        original = row.get("image_filename", "")
        resolved = file_index.get(original)
        if resolved:
            row["file_path"] = resolved
            matched += 1
        else:
            row["file_path"] = ""
            unmatched += 1

    # Backup original
    backup_path = csv_path + ".bak"
    shutil.copy2(csv_path, backup_path)
    print(f"Backup saved to {backup_path}")

    # Write corrected CSV
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Done: {matched} matched, {unmatched} unmatched out of {len(rows)} rows")


if __name__ == "__main__":
    main()
