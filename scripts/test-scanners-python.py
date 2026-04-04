#!/usr/bin/env python3
"""Test parallel scanning with Python SANE — matches how the app works.

Update SCANNERS list from: lsusb | grep EPSON

Usage:
    python3 test-scanners-python.py              # parallel
    python3 test-scanners-python.py seq          # sequential init, then parallel scan
    SANE_USB_WORKAROUND=1 python3 test-scanners-python.py  # with USB workaround
"""

import os
import sys
import time
import multiprocessing

# Update these from: lsusb | grep EPSON
SCANNERS = [
    "epkowa:interpreter:009:007",
    "epkowa:interpreter:011:002",
    "epkowa:interpreter:013:002",
    "epkowa:interpreter:015:002",
]

RESOLUTION = 1200


def scan_worker(device_name, index, output_dir):
    """Run in a separate process — each gets its own sane.init()."""
    import sane

    result = {"index": index, "device": device_name, "success": False, "error": None, "time": 0}
    start = time.time()

    try:
        print(f"[Scanner {index}] Initializing SANE...")
        sane.init()
        print(f"[Scanner {index}] SANE initialized")

        print(f"[Scanner {index}] Opening device: {device_name}")
        device = sane.open(device_name)
        print(f"[Scanner {index}] Device opened in {time.time() - start:.1f}s")

        # Set scan parameters (use x_resolution/y_resolution like epkowa expects)
        device.x_resolution = RESOLUTION
        device.y_resolution = RESOLUTION
        device.tl_x = 5
        device.tl_y = 5
        device.br_x = 210
        device.br_y = 150
        device.mode = "Color"

        print(f"[Scanner {index}] Starting scan at {RESOLUTION}dpi...")
        scan_start = time.time()
        device.start()
        im = device.snap()

        output_path = os.path.join(output_dir, f"scanner{index}.tif")
        im.save(output_path)

        elapsed = time.time() - scan_start
        print(f"[Scanner {index}] Scan complete in {elapsed:.1f}s — saved to {output_path}")

        device.close()
        sane.exit()

        result["success"] = True
        result["time"] = time.time() - start

    except Exception as e:
        result["error"] = str(e)
        result["time"] = time.time() - start
        print(f"[Scanner {index}] FAILED after {result['time']:.1f}s: {e}")

        try:
            sane.exit()
        except Exception:
            pass

    return result


def sequential_init_test():
    """Test connecting each scanner one at a time."""
    import sane

    print("--- Sequential init test ---")
    for i, device_name in enumerate(SCANNERS):
        start = time.time()
        try:
            sane.init()
            device = sane.open(device_name)
            elapsed = time.time() - start
            print(f"[Scanner {i+1}] Connected OK ({elapsed:.1f}s) — {device_name}")
            device.close()
            sane.exit()
        except Exception as e:
            elapsed = time.time() - start
            print(f"[Scanner {i+1}] FAILED ({elapsed:.1f}s) — {e}")
            try:
                sane.exit()
            except Exception:
                pass
    print()


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "parallel"

    output_dir = f"/tmp/scan-python-{int(time.time())}"
    os.makedirs(output_dir, exist_ok=True)

    print(f"=== Python SANE Scan Test ({RESOLUTION}dpi) ===")
    print(f"SANE_USB_WORKAROUND={os.environ.get('SANE_USB_WORKAROUND', 'not set')}")
    print(f"Output: {output_dir}")
    print()

    if mode == "seq":
        sequential_init_test()

    print("--- Parallel scan ---")
    start = time.time()

    processes = []
    for i, device_name in enumerate(SCANNERS):
        p = multiprocessing.Process(
            target=scan_worker,
            args=(device_name, i + 1, output_dir),
        )
        processes.append(p)
        p.start()

    for p in processes:
        p.join()

    elapsed = time.time() - start

    print()
    print(f"=== Results ({elapsed:.1f}s) ===")
    for i in range(len(SCANNERS)):
        path = os.path.join(output_dir, f"scanner{i+1}.tif")
        if os.path.exists(path) and os.path.getsize(path) > 0:
            size_mb = os.path.getsize(path) / 1024 / 1024
            print(f"  Scanner {i+1}: OK ({size_mb:.1f}MB)")
        else:
            print(f"  Scanner {i+1}: FAILED")


if __name__ == "__main__":
    main()
