#!/bin/bash
# Test a single scanner — connect and scan
# Usage:
#   ./test-single-scanner.sh                              # uses SCANNER1 default
#   ./test-single-scanner.sh epkowa:interpreter:011:002   # specific device
#   SANE_USB_WORKAROUND=1 ./test-single-scanner.sh        # with USB workaround

DEVICE="${1:-epkowa:interpreter:009:010}"
RESOLUTION=1200
OUT="/tmp/scan-single-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$OUT"

echo "=== Single Scanner Test ==="
echo "Device: $DEVICE"
echo "Resolution: ${RESOLUTION}dpi"
echo "SANE_USB_WORKAROUND=${SANE_USB_WORKAROUND:-not set}"
echo ""

echo "[1/3] Connecting..."
START=$(date +%s)
scanimage -d "$DEVICE" --x-resolution=200 --y-resolution=200 --format=tiff -x 10 -y 10 > /dev/null 2>"$OUT/connect.log"
if [ $? -eq 0 ]; then
    echo "[1/3] Connected OK ($(($(date +%s)-START))s)"
else
    echo "[1/3] FAILED to connect"
    cat "$OUT/connect.log"
    exit 1
fi

echo "[2/3] Scanning at ${RESOLUTION}dpi..."
START=$(date +%s)
scanimage -d "$DEVICE" --x-resolution=$RESOLUTION --y-resolution=$RESOLUTION --format=tiff -x 210 -y 150 > "$OUT/scan.tif" 2>"$OUT/scan.log"
if [ $? -eq 0 ]; then
    SIZE=$(du -h "$OUT/scan.tif" | cut -f1)
    echo "[2/3] Scan complete ($(($(date +%s)-START))s) — $SIZE"
else
    echo "[2/3] Scan FAILED"
    cat "$OUT/scan.log"
    exit 1
fi

echo "[3/3] Output: $OUT/scan.tif"
echo ""
echo "=== SUCCESS ==="
