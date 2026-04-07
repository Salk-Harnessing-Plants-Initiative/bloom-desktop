#!/usr/bin/env python3
"""Stress test: 100 parallel scan cycles with interval between each.

Usage:
    python3 test-stress-scan.py                    # 400 DPI, 5min interval, 100 cycles
    python3 test-stress-scan.py 1200               # 1200 DPI
    python3 test-stress-scan.py 400 60 10          # 400 DPI, 60s interval, 10 cycles
"""
import subprocess, time, os, sys, datetime

SCANNERS = [
    ("001:008", "epkowa:interpreter:001:008"),
    ("001:010", "epkowa:interpreter:001:010"),
    ("001:011", "epkowa:interpreter:001:011"),
    ("015:004", "epkowa:interpreter:015:004"),
    ("015:005", "epkowa:interpreter:015:005"),
]

RESOLUTION = int(sys.argv[1]) if len(sys.argv) > 1 else 400
INTERVAL = int(sys.argv[2]) if len(sys.argv) > 2 else 300  # 5 min default
CYCLES = int(sys.argv[3]) if len(sys.argv) > 3 else 100
PRELOAD = os.path.expanduser("~/Downloads/libusb-filter.so")
LOG_DIR = os.path.expanduser(f"~/stress-test-{int(time.time())}")
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, "results.log")

WORKER = '''
import sane, sys, time
dev_name, res, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
start = time.time()
sane.init()
d = sane.open(dev_name)
connect_time = time.time() - start
d.x_resolution = res; d.y_resolution = res
d.mode = "Color"; d.tl_x = 40; d.tl_y = 5; d.br_x = 180; d.br_y = 145
scan_start = time.time()
d.start(); im = d.snap(); im.save(out)
scan_time = time.time() - scan_start
d.close(); sane.exit()
print(f"connect={connect_time:.1f}s scan={scan_time:.1f}s")
'''


def log(msg):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")


def run_cycle(cycle_num):
    cycle_dir = os.path.join(LOG_DIR, f"cycle_{cycle_num:03d}")
    os.makedirs(cycle_dir, exist_ok=True)

    log(f"--- Cycle {cycle_num}/{CYCLES} ---")
    start = time.time()
    procs = []

    for usb_id, sane_name in SCANNERS:
        out = os.path.join(cycle_dir, f"scanner_{usb_id.replace(':', '_')}.tif")
        env = {**os.environ, "SANE_USB_FILTER": usb_id, "LD_PRELOAD": PRELOAD}
        p = subprocess.Popen(
            [sys.executable, "-c", WORKER, sane_name, str(RESOLUTION), out],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        procs.append((usb_id, sane_name, out, p))

    results = []
    for usb_id, sane_name, out, p in procs:
        stdout, stderr = p.communicate()
        size = os.path.getsize(out) if os.path.exists(out) else 0
        ok = size > 0
        timing = stdout.decode().strip() if stdout else ""
        err = ""
        if not ok and stderr:
            err_lines = [l for l in stderr.decode().split("\n") if "libusb-filter" not in l and l.strip()]
            err = err_lines[-1] if err_lines else ""
        results.append((usb_id, ok, size, timing, err))

    elapsed = time.time() - start
    success = sum(1 for _, ok, *_ in results if ok)
    log(f"  Result: {success}/{len(SCANNERS)} OK in {elapsed:.1f}s")
    for usb_id, ok, size, timing, err in results:
        if ok:
            log(f"    {usb_id}: OK ({size / 1024 / 1024:.1f}MB) {timing}")
        else:
            log(f"    {usb_id}: FAILED — {err}")

    return success == len(SCANNERS)


# Main
log(f"=== Stress Test: {CYCLES} cycles, {RESOLUTION}dpi, {len(SCANNERS)} scanners, {INTERVAL}s interval ===")
log(f"Log dir: {LOG_DIR}")
log(f"Log file: {LOG_FILE}")
log(f"LD_PRELOAD: {PRELOAD}")
log("")

total_success = 0
total_fail = 0

for cycle in range(1, CYCLES + 1):
    if run_cycle(cycle):
        total_success += 1
    else:
        total_fail += 1

    log(f"  Running total: {total_success} passed, {total_fail} failed ({total_success}/{cycle} = {100 * total_success / cycle:.1f}%)")

    if cycle < CYCLES:
        log(f"  Waiting {INTERVAL}s until next cycle...")
        time.sleep(INTERVAL)

log("")
log(f"=== FINAL: {total_success}/{CYCLES} cycles passed ({100 * total_success / CYCLES:.1f}%) ===")
log(f"  Failed: {total_fail}")
log(f"  Log: {LOG_FILE}")
