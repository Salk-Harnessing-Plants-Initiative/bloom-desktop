#!/usr/bin/env python3
"""Parallel scan test with LD_PRELOAD USB filter on AMD USB.

Usage:
    python3 test-parallel-amd.py              # 400 DPI
    python3 test-parallel-amd.py 1200         # 1200 DPI
"""
import subprocess, time, os, sys

SCANNERS = [
    ("001:008", "epkowa:interpreter:001:008"),
    ("001:020", "epkowa:interpreter:001:020"),
    ("001:021", "epkowa:interpreter:001:021"),
]

RESOLUTION = int(sys.argv[1]) if len(sys.argv) > 1 else 400
PRELOAD = os.path.expanduser("~/Downloads/libusb-filter.so")
OUTPUT = f"/tmp/pypar-{int(time.time())}"
os.makedirs(OUTPUT, exist_ok=True)

print(f"=== Parallel Python SANE Test ({RESOLUTION}dpi, {len(SCANNERS)} scanners) ===")
print(f"Output: {OUTPUT}")
print(f"LD_PRELOAD: {PRELOAD}")
print()

WORKER = '''
import sane, sys, time
dev_name, res, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
start = time.time()
sane.init()
d = sane.open(dev_name)
print(f"[{dev_name}] Connected in {time.time()-start:.1f}s")
d.x_resolution = res; d.y_resolution = res
d.mode = "Color"; d.tl_x = 5; d.tl_y = 5; d.br_x = 210; d.br_y = 150
scan_start = time.time()
d.start(); im = d.snap(); im.save(out)
print(f"[{dev_name}] Scanned in {time.time()-scan_start:.1f}s")
d.close(); sane.exit()
'''

start = time.time()
procs = []
for usb_id, sane_name in SCANNERS:
    out = f"{OUTPUT}/scanner_{usb_id.replace(':', '_')}.tif"
    env = {**os.environ, "SANE_USB_FILTER": usb_id, "LD_PRELOAD": PRELOAD}
    p = subprocess.Popen(
        [sys.executable, "-c", WORKER, sane_name, str(RESOLUTION), out],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    procs.append((usb_id, sane_name, out, p))
    print(f"  Started {usb_id} [{sane_name}]")

print()
for usb_id, sane_name, out, p in procs:
    stdout, stderr = p.communicate()
    if stdout:
        print(stdout.decode(), end="")
    size = os.path.getsize(out) if os.path.exists(out) else 0
    status = f"OK ({size / 1024 / 1024:.1f}MB)" if size > 0 else f"FAILED (exit {p.returncode})"
    print(f"  {usb_id} [{sane_name}]: {status}")
    if p.returncode != 0 and stderr:
        err_lines = [l for l in stderr.decode().split("\n") if "libusb-filter" not in l and l.strip()]
        if err_lines:
            print(f"    Error: {err_lines[-1]}")

print(f"\nTotal: {time.time() - start:.1f}s")
