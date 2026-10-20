#!/usr/bin/env bash
# Rebuild the app icons from assets/icons/icon.svg (macOS: needs rsvg-convert,
# ImageMagick `magick`, and iconutil).
#   icon.ico   Windows: 16-256 px (256 is the largest Windows uses)
#   icon.icns  macOS:   16-1024 px
#   icon.png   Linux:   512 px
set -euo pipefail
cd "$(dirname "$0")/../assets/icons"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for s in 16 24 32 48 64 128 256; do rsvg-convert -w "$s" -h "$s" icon.svg -o "$tmp/ico-$s.png"; done
magick "$tmp"/ico-16.png "$tmp"/ico-24.png "$tmp"/ico-32.png "$tmp"/ico-48.png \
  "$tmp"/ico-64.png "$tmp"/ico-128.png "$tmp"/ico-256.png icon.ico

mkdir "$tmp/icon.iconset"
for s in 16 32 128 256 512; do
  rsvg-convert -w "$s" -h "$s" icon.svg -o "$tmp/icon.iconset/icon_${s}x${s}.png"
  rsvg-convert -w $((s * 2)) -h $((s * 2)) icon.svg -o "$tmp/icon.iconset/icon_${s}x${s}@2x.png"
done
iconutil -c icns "$tmp/icon.iconset" -o icon.icns

rsvg-convert -w 512 -h 512 icon.svg -o icon.png
echo "Wrote icon.ico, icon.icns and icon.png"
