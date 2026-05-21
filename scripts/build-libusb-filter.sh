#!/usr/bin/env bash
# Build the LD_PRELOAD libusb-filter shim.
#
# Compiles src/main/native/libusb-filter.c into a Linux shared library
# at src/main/native/libusb-filter.so. The shim:
#   1. Intercepts libusb_open() to allow only the scanner named by
#      SANE_USB_FILTER (so epkowa can't claim every Epson device on
#      every invocation). See #171 and PR #227.
#   2. Intercepts libusb_bulk_transfer() and on TIMEOUT/PIPE for an
#      IN endpoint calls libusb_clear_halt() to recover the data
#      toggle. Controlled by LIBUSB_ENDPOINT_RECOVERY env var,
#      default-on. See #228 Task 4.
#
# Linux-only. macOS/Windows builds skip this script silently
# (forge.config.ts has a platform guard on the .so copy).
#
# Usage:
#   bash scripts/build-libusb-filter.sh
#
# Called from package.json "build:native" and the "prepackage" hook.
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "[build-libusb-filter] Skipping on non-Linux platform: $(uname -s)"
  exit 0
fi

if ! command -v gcc >/dev/null 2>&1; then
  echo "[build-libusb-filter] ERROR: gcc not installed. Install with:" >&2
  echo "  sudo apt install build-essential libusb-1.0-0-dev pkg-config" >&2
  exit 1
fi

if ! pkg-config --exists libusb-1.0; then
  echo "[build-libusb-filter] ERROR: libusb-1.0 dev headers not found. Install with:" >&2
  echo "  sudo apt install libusb-1.0-0-dev" >&2
  exit 1
fi

SRC="src/main/native/libusb-filter.c"
OUT="src/main/native/libusb-filter.so"

echo "[build-libusb-filter] Compiling $SRC → $OUT"
gcc -shared -fPIC -O2 -Wall \
    -o "$OUT" \
    "$SRC" \
    -ldl \
    $(pkg-config --cflags --libs libusb-1.0)

echo "[build-libusb-filter] Built $OUT ($(stat -c %s "$OUT") bytes)"
