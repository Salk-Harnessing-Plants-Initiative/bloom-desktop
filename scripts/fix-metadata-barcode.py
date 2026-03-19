#!/usr/bin/env python3
"""Replace plate_barcode values in metadata.csv.

Usage:
    python scripts/fix-metadata-barcode.py <path-to-metadata.csv> OLD=NEW [OLD=NEW ...]

Example:
    python scripts/fix-metadata-barcode.py metadata.csv Plate_1=PB001 Plate_2=PB002

The corrected CSV is written in-place (original backed up as metadata.csv.bak).
"""

import csv
import shutil
import sys


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: python fix-metadata-barcode.py <path-to-metadata.csv> OLD=NEW [OLD=NEW ...]")
        print("Example: python fix-metadata-barcode.py metadata.csv Plate_1=PB001 Plate_2=PB002")
        sys.exit(1)

    csv_path = sys.argv[1]
    replacements: dict[str, str] = {}
    for arg in sys.argv[2:]:
        if "=" not in arg:
            print(f"Invalid mapping (expected OLD=NEW): {arg}")
            sys.exit(1)
        old, new = arg.split("=", 1)
        replacements[old] = new

    print(f"Barcode replacements: {replacements}")

    # Read original CSV
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)

    if "plate_barcode" not in fieldnames:
        print("Error: no plate_barcode column found in CSV")
        sys.exit(1)

    replaced = 0
    unchanged = 0
    counts: dict[str, int] = {old: 0 for old in replacements}

    for row in rows:
        barcode = row.get("plate_barcode", "")
        if barcode in replacements:
            row["plate_barcode"] = replacements[barcode]
            counts[barcode] += 1
            replaced += 1
        else:
            unchanged += 1

    # Backup original
    backup_path = csv_path + ".bak"
    shutil.copy2(csv_path, backup_path)
    print(f"Backup saved to {backup_path}")

    # Write corrected CSV
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Done: {replaced} replaced, {unchanged} unchanged out of {len(rows)} rows")
    for old, count in counts.items():
        print(f"  {old} -> {replacements[old]}: {count} rows")


if __name__ == "__main__":
    main()
