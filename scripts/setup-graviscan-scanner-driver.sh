#!/bin/bash
# Install the Epson iscan/epkowa SANE driver on Ubuntu 24.04+ without
# permanently breaking apt (see issue #226).
#
# Ubuntu 24.04 renamed libsane to libsane1; Ubuntu 26.04 separately
# renamed libxml2 to libxml2-16 (these are two different releases, not
# one rename event). Epson's iscan .deb still declares a hard
# dependency on the old libxml2 name, and the old epkowa backend
# binary is itself dynamically linked against the old libxml2 ABI
# (soname .so.2, not libxml2-16's .so.16).
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
# - A scanner should be plugged in and powered on before running this,
#   so Step 6 can perform a real verification scan.
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
# If this specific build is ever removed from the archive: browse
# https://archive.ubuntu.com/ubuntu/pool/main/libx/libxml2/ for another
# "+really2.9.x" or plain 2.9.x amd64 build (any of them ship the same
# soname and will work), update both the URL and the checksum below,
# and note the update in docs/GRAVISCAN_SCANNER_DRIVER_SETUP.md.
OLD_LIBXML2_URL="https://archive.ubuntu.com/ubuntu/pool/main/libx/libxml2/libxml2_2.12.7+dfsg+really2.9.14-0.4ubuntu0.4_amd64.deb"
OLD_LIBXML2_SHA256="685e94ff7fd7ad869894c2317ab9473075536a5c74c092ca5a9cd5876acaaf6c"

if [ -z "$BUNDLE_DIR" ] || [ ! -d "$BUNDLE_DIR" ]; then
  echo "Usage: $0 <path-to-extracted-iscan-bundle>" >&2
  echo "  (the directory containing install.sh, core/, data/, plugins/)" >&2
  exit 1
fi

if [ ! -f "$BUNDLE_DIR/install.sh" ]; then
  echo "Error: $BUNDLE_DIR does not look like an extracted iscan bundle (no install.sh found)" >&2
  exit 1
fi

EPKOWA_SO="/usr/lib/x86_64-linux-gnu/sane/libsane-epkowa.so.1"

echo "=== Step 1: Install iscan via Epson's own installer ==="
echo "Modern iscan (2.30.6+) already accepts libsane1 via an OR-dependency,"
echo "so this step needs no --ignore-depends flag at all."
chmod +x "$BUNDLE_DIR/install.sh"
(cd "$BUNDLE_DIR" && sudo ./install.sh --with-network --with-ocr-engine)

if [ ! -f "$EPKOWA_SO" ]; then
  echo "Error: $EPKOWA_SO not found after install.sh ran - Step 1 itself failed." >&2
  echo "Check install.sh's output above before continuing." >&2
  exit 1
fi

echo
echo "=== Step 2: Fix the libxml2 runtime dependency ==="
# LC_ALL=C keeps ldd's "=> not found" phrasing stable regardless of the
# operator's locale. We distinguish three states explicitly rather than
# a single grep, so a Step 1 failure (the .so missing some other
# dependency entirely) can't be silently misread as "already resolved."
LDD_OUTPUT="$(LC_ALL=C ldd "$EPKOWA_SO" 2>&1)"
if echo "$LDD_OUTPUT" | grep -q "libxml2.so.2 => not found"; then
  echo "epkowa needs the old libxml2 ABI (.so.2) - installing a real compatible build."
  TMP_DEB="/tmp/$(basename "$OLD_LIBXML2_URL")"
  curl -fSL -o "$TMP_DEB" "$OLD_LIBXML2_URL"
  echo "$OLD_LIBXML2_SHA256  $TMP_DEB" | sha256sum -c -
  # Direct dpkg -i (not apt install) so this succeeds regardless of
  # version/epoch comparison against whatever libxml2 is currently
  # installed (e.g. if a dummy/equivs libxml2 package was created as
  # an earlier debugging step and needs replacing).
  sudo dpkg -i "$TMP_DEB"
  rm -f "$TMP_DEB"
elif echo "$LDD_OUTPUT" | grep -q "not found"; then
  echo "Error: $EPKOWA_SO has unresolved dependencies beyond libxml2:" >&2
  echo "$LDD_OUTPUT" | grep "not found" >&2
  echo "This script doesn't know how to fix these - investigate before continuing." >&2
  exit 1
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
echo "=== Step 6: Verify with a real scan (not just detection) ==="
DEVICE="$(scanimage -L 2>/dev/null | grep -oE "epkowa:interpreter:[0-9]+:[0-9]+" | head -1 || true)"
if [ -z "$DEVICE" ]; then
  echo "Scanner not detected via epkowa. Check that it's plugged in and powered on," >&2
  echo "then re-run this script (steps are idempotent)." >&2
  exit 1
fi
echo "Detected: $DEVICE - running a real low-resolution test scan..."
TEST_SCAN="/tmp/graviscan-driver-setup-test-scan.tiff"
scanimage -d "$DEVICE" --resolution 400 --format=tiff >"$TEST_SCAN" 2>/tmp/graviscan-driver-setup-test-scan.log
if file "$TEST_SCAN" | grep -q "TIFF image data"; then
  echo "Success - real scan produced a valid TIFF: $(file -b "$TEST_SCAN")"
  rm -f "$TEST_SCAN" /tmp/graviscan-driver-setup-test-scan.log
else
  echo "Error: scan ran but did not produce a valid TIFF. See $TEST_SCAN and" >&2
  echo "/tmp/graviscan-driver-setup-test-scan.log for details." >&2
  exit 1
fi
