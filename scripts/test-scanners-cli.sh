#!/bin/bash
# Test parallel scanning with scanimage CLI
# Update device paths from: lsusb | grep EPSON
#
# Usage:
#   ./test-scanners-cli.sh              # parallel
#   ./test-scanners-cli.sh seq          # sequential init, then parallel scan
#   SANE_USB_WORKAROUND=1 ./test-scanners-cli.sh  # with USB workaround

SCANNER1="epkowa:interpreter:009:007"
SCANNER2="epkowa:interpreter:011:002"
SCANNER3="epkowa:interpreter:013:002"
SCANNER4="epkowa:interpreter:015:002"

RESOLUTION=1200
OUT="/tmp/scan-cli-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$OUT"

echo "=== CLI Scan Test (${RESOLUTION}dpi) ==="
echo "SANE_USB_WORKAROUND=${SANE_USB_WORKAROUND:-not set}"
echo ""

pkill -f scanimage 2>/dev/null || true
pkill -f bloom-hardware 2>/dev/null || true
sleep 3

if [ "${1:-}" = "seq" ]; then
    echo "--- Sequential init ---"
    for S in "$SCANNER1" "$SCANNER2" "$SCANNER3" "$SCANNER4"; do
        echo "Testing $S..."
        scanimage -d "$S" --x-resolution=200 --y-resolution=200 --format=tiff -x 10 -y 10 > /dev/null 2>&1 && echo "  OK" || echo "  FAILED"
    done
    echo ""
fi

echo "--- Parallel ${RESOLUTION}dpi scan ---"
START=$(date +%s)

scanimage -d "$SCANNER1" --x-resolution=$RESOLUTION --y-resolution=$RESOLUTION --format=tiff -x 210 -y 150 > "$OUT/s1.tif" 2>"$OUT/s1.log" &
scanimage -d "$SCANNER2" --x-resolution=$RESOLUTION --y-resolution=$RESOLUTION --format=tiff -x 210 -y 150 > "$OUT/s2.tif" 2>"$OUT/s2.log" &
scanimage -d "$SCANNER3" --x-resolution=$RESOLUTION --y-resolution=$RESOLUTION --format=tiff -x 210 -y 150 > "$OUT/s3.tif" 2>"$OUT/s3.log" &
scanimage -d "$SCANNER4" --x-resolution=$RESOLUTION --y-resolution=$RESOLUTION --format=tiff -x 210 -y 150 > "$OUT/s4.tif" 2>"$OUT/s4.log" &
wait

END=$(date +%s)
echo "Time: $((END-START))s"
echo ""
echo "Results:"
for i in 1 2 3 4; do
    if [ -s "$OUT/s$i.tif" ]; then
        echo "  Scanner $i: OK ($(du -h "$OUT/s$i.tif" | cut -f1))"
    else
        echo "  Scanner $i: FAILED"
        cat "$OUT/s$i.log" 2>/dev/null | head -3
    fi
done
