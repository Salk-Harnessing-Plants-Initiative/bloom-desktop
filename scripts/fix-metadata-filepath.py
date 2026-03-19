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


def build_file_index(directory: str) -> tuple[dict[str, str], set[str]]:
    """Index .tif files two ways: by stripped key (without _et_) and exact name.

    Returns (stripped_key -> filename, set of all filenames on disk).
    """
    index: dict[str, str] = {}
    all_files: set[str] = set()
    for fname in os.listdir(directory):
        if not fname.lower().endswith((".tif", ".tiff")):
            continue
        all_files.add(fname)
        # Strip out _et_YYYYMMDDTHHMMSS to get the lookup key
        key = re.sub(r"_et_\d{8}T\d{6}", "", fname)
        index[key] = fname
    return index, all_files


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python fix-metadata-filepath.py <path-to-metadata.csv>")
        sys.exit(1)

    csv_path = sys.argv[1]
    if not os.path.isfile(csv_path):
        print(f"File not found: {csv_path}")
        sys.exit(1)

    directory = os.path.dirname(os.path.abspath(csv_path))
    file_index, all_files = build_file_index(directory)
    print(f"Indexed {len(all_files)} image files in {directory}")

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
        if original in all_files:
            # image_filename already has full name (with _et_) — verify it exists
            row["file_path"] = original
            matched += 1
        else:
            # image_filename is missing _et_ — look up via stripped key
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
