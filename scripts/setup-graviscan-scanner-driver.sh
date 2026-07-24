#!/bin/bash
# Install the Epson iscan/epkowa SANE driver on Ubuntu 24.04+ without
# permanently breaking apt (see issue #226).
#
# Ubuntu renamed several packages to match their sonames (libsane ->
# libsane1, libxml2 -> libxml2-16). Epson's iscan .deb still declares a
# hard dependency on the old names for some of its own dependencies,
# and the old epkowa backend binary is itself dynamically linked
# against the old libxml2 ABI (soname .so.2, not libxml2-16's .so.16).
#
# The previously-used workaround (`dpkg --ignore-depends -i iscan.deb`)
# "works" but leaves apt permanently unable to install/upgrade anything
# afterward, because apt's dependency graph is left in a genuinely
# broken state. This script installs a real, ABI-compatible old
# libxml2 build instead of faking the dependency, so apt stays fully
# consistent afterward.
#
# Prerequisites:
# - Run on the target Linux machine (Ubuntu 24.04+), not via cross-compile.
# - Download the iscan bundle for your scanner model yourself first, e.g.
#   from https://download.ebz.epson.net/dsc/search/01/search/?OSC=LX
#   (the site blocks scripted downloads - use a browser). Extract it
#   locally; you should have core/, data/, and plugins/ subdirectories
#   each containing one .deb.
#
# Usage:
#   ./scripts/setup-graviscan-scanner-driver.sh <path-to-extracted-iscan-bundle>
#
# Example:
#   ./scripts/setup-graviscan-scanner-driver.sh ~/Downloads/iscan/iscan-gt-x820-bundle-2.30.6.x64.deb

set -e

BUNDLE_DIR="$1"
# Ubuntu archive package that still ships the old libxml2 ABI (soname
# .so.2) under a newer, security-patched version string. Confirmed
# working against iscan 2.30.6-1 / epkowa on Ubuntu 26.04 (2026-07-24).
# If this specific build is ever removed from the archive, browse
# http://archive.ubuntu.com/ubuntu/pool/main/libx/libxml2/ for another
# "+really2.9.x" or plain 2.9.x amd64 build - any of them ship the
# same soname and will work.
OLD_LIBXML2_URL="http://archive.ubuntu.com/ubuntu/pool/main/libx/libxml2/libxml2_2.12.7+dfsg+really2.9.14-0.4ubuntu0.4_amd64.deb"

if [ -z "$BUNDLE_DIR" ] || [ ! -d "$BUNDLE_DIR" ]; then
  echo "Usage: $0 <path-to-extracted-iscan-bundle>" >&2
  echo "  (the directory containing install.sh, core/, data/, plugins/)" >&2
  exit 1
fi

if [ ! -f "$BUNDLE_DIR/install.sh" ]; then
  echo "Error: $BUNDLE_DIR does not look like an extracted iscan bundle (no install.sh found)" >&2
  exit 1
fi

echo "=== Step 1: Install iscan via Epson's own installer ==="
echo "Modern iscan (2.30.6+) already accepts libsane1 via an OR-dependency,"
echo "so this step needs no --ignore-depends flag at all."
chmod +x "$BUNDLE_DIR/install.sh"
(cd "$BUNDLE_DIR" && sudo ./install.sh --with-network --with-ocr-engine)

echo
echo "=== Step 2: Fix the libxml2 runtime dependency ==="
if ldd /usr/lib/x86_64-linux-gnu/sane/libsane-epkowa.so.1 2>/dev/null | grep -q "libxml2.so.2 => not found"; then
  echo "epkowa needs the old libxml2 ABI (.so.2) - installing a real compatible build."
  TMP_DEB="/tmp/$(basename "$OLD_LIBXML2_URL")"
  curl -sL -o "$TMP_DEB" "$OLD_LIBXML2_URL"
  # Direct dpkg -i (not apt install) so it replaces any prior stub
  # cleanly regardless of version/epoch comparison.
  sudo dpkg -i "$TMP_DEB"
  rm -f "$TMP_DEB"
else
  echo "libxml2.so.2 already resolves - nothing to do."
fi

echo
echo "=== Step 3: Ensure apt is still fully consistent ==="
sudo apt-get check
echo "apt-get check passed - no broken dependencies."

echo
echo "=== Step 4: Enable the epkowa backend in SANE's active backend list ==="
if ! grep -qx "epkowa" /etc/sane.d/dll.conf; then
  echo "epkowa" | sudo tee -a /etc/sane.d/dll.conf >/dev/null
  echo "Added epkowa to /etc/sane.d/dll.conf"
else
  echo "epkowa already enabled in dll.conf."
fi

echo
echo "=== Step 5: Re-apply udev rules to already-connected devices ==="
echo "(needed if the scanner was plugged in before this script ran)"
sudo udevadm control --reload-rules
sudo udevadm trigger

echo
echo "=== Step 6: Verify ==="
if scanimage -L 2>/dev/null | grep -q "epkowa:interpreter"; then
  echo "Success - scanner detected:"
  # -o extracts just the matching device line; other SANE network
  # backends (escl/airscan/hpaio) can print large amounts of unrelated
  # HTML on stdout during discovery (see docs/GRAVISCAN_SCANNER_DRIVER_SETUP.md),
  # which can end up concatenated onto the same line without -o.
  scanimage -L 2>/dev/null | grep -oE "device .epkowa:interpreter[^ ]*. is a [^\`]*"
else
  echo "Scanner not detected via epkowa. Check that it's plugged in and powered on," >&2
  echo "then re-run this script (steps are idempotent)." >&2
  exit 1
fi
