#!/usr/bin/env python3
"""
Bloom Hardware Interface
Entry point for the Python hardware control backend.

Can run in several modes:
  1. IPC mode (--ipc): JSON-based stdin/stdout communication for Electron
  2. Scan-worker mode (--scan-worker): one long-lived subprocess per scanner
  3. QR batch mode (--decode-qr-batch): one-shot QR decode of a batch of
     scan images, used by the graviscan:verify-plates handler
  4. Interactive mode (default): Human-friendly CLI for testing
"""

import json
import platform
import sys
import argparse


def interactive_mode():
    """Run in interactive CLI mode for human testing."""
    print("=" * 50)
    print("Bloom Hardware Interface - Interactive Mode")
    print("=" * 50)
    print(f"Python Version: {platform.python_version()}")
    print(f"Platform: {platform.system()} {platform.release()}")

    # Test imports
    try:
        import numpy as np

        print(f"[OK] NumPy {np.__version__}")
    except ImportError as e:
        print(f"[FAIL] NumPy: {e}")

    try:
        import pypylon

        print("[OK] PyPylon available")
    except ImportError as e:
        print(f"[FAIL] PyPylon: {e}")

    try:
        import nidaqmx

        print("[OK] NI-DAQmx available")
    except ImportError as e:
        print(f"[FAIL] NI-DAQmx: {e}")

    print("=" * 50)
    print("Ready. Type 'exit' to quit.")
    print("=" * 50)

    # Simple command loop
    while True:
        try:
            cmd = input("> ").strip()
            if cmd.lower() in ("exit", "quit"):
                print("Shutting down...")
                break
            elif cmd.lower() == "help":
                print("Available commands: help, exit, version")
            elif cmd.lower() == "version":
                print(f"Python {platform.python_version()}")
            else:
                print(f"Unknown command: {cmd}")
        except (EOFError, KeyboardInterrupt):
            print("\nShutting down...")
            break


def ipc_mode():
    """Run in IPC mode for Electron communication."""
    try:
        from python.ipc_handler import run_ipc_loop
    except ModuleNotFoundError:
        # When running as PyInstaller bundle, try direct import
        from ipc_handler import run_ipc_loop  # type: ignore[import-not-found]
    run_ipc_loop()


def scan_worker_mode(scanner_id: str, device: str, mock: bool = False):
    """Run as a scan worker subprocess for a single scanner."""
    try:
        from python.graviscan.scan_worker import run_worker
    except ModuleNotFoundError:
        from graviscan.scan_worker import run_worker  # type: ignore[import-not-found,no-redef]
    run_worker(scanner_id, device, mock)


def decode_qr_batch_mode():
    """Decode QR codes for a batch of scan images, then exit.

    Wire protocol (consumed by src/main/qr-reader.ts):
      stdin  <- JSON array of absolute image paths. Paths arrive on stdin
                rather than argv so a large batch cannot hit the Windows
                command-line length limit.
      stdout -> JSON array of {"path": str, "codes": [str, ...]}, one entry
                per input path, in input order. Diagnostics go to stderr so
                stdout stays parseable.

    A single unreadable image yields an empty "codes" list for that path; only
    a malformed request (not a JSON array) is a hard, non-zero-exit failure.

    All three streams are forced to UTF-8. Python otherwise decodes stdin and
    encodes stdout/stderr with the locale codepage, which on a Windows rig
    would mangle any non-ASCII character in a scan path — in the request, in
    the echoed-back response, and in the diagnostics (qr_reader logs image
    basenames to stderr, so a non-ASCII filename produced undecodable bytes
    there; confirmed against an actual PyInstaller build). src/main/qr-reader.ts
    also sets PYTHONIOENCODING/PYTHONUTF8 on the subprocess env, but this must
    not depend on the caller having done so.
    """
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8")

    try:
        from python.graviscan.qr_reader import decode_qr_codes
    except ModuleNotFoundError:
        # When running as PyInstaller bundle, try direct import
        from graviscan.qr_reader import (  # type: ignore[import-not-found,no-redef]
            decode_qr_codes,
        )

    raw = sys.stdin.read().strip()
    if not raw:
        image_paths = []
    else:
        try:
            image_paths = json.loads(raw)
        except json.JSONDecodeError as exc:
            print(f"[decode-qr-batch] invalid JSON on stdin: {exc}", file=sys.stderr)
            sys.exit(1)
        if not isinstance(image_paths, list):
            print(
                "[decode-qr-batch] expected a JSON array of image paths on stdin, "
                f"got {type(image_paths).__name__}",
                file=sys.stderr,
            )
            sys.exit(1)

    results = [{"path": p, "codes": decode_qr_codes(p)} for p in image_paths]
    json.dump(results, sys.stdout)
    sys.stdout.write("\n")
    sys.stdout.flush()


def main():
    """Route to interactive, IPC, scan-worker, or QR-batch mode."""
    parser = argparse.ArgumentParser(description="Bloom Hardware Interface")
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--ipc", action="store_true", help="Run in IPC mode for Electron communication"
    )
    mode_group.add_argument(
        "--scan-worker", action="store_true", help="Run as scan worker subprocess"
    )
    mode_group.add_argument(
        "--decode-qr-batch",
        action="store_true",
        help="Decode QR codes for a batch of images (JSON paths on stdin)",
    )
    parser.add_argument(
        "--scanner-id", type=str, help="Scanner UUID (scan-worker mode)"
    )
    parser.add_argument(
        "--device", type=str, help="SANE device name (scan-worker mode)"
    )
    parser.add_argument(
        "--mock", action="store_true", help="Use mock scanner (scan-worker mode)"
    )
    args = parser.parse_args()

    if args.scan_worker:
        if not args.scanner_id:
            parser.error("--scan-worker requires --scanner-id")
        if not args.mock and not args.device:
            parser.error("--scan-worker requires --device unless --mock is specified")
        scan_worker_mode(args.scanner_id, args.device or "mock-device", args.mock)
    elif args.decode_qr_batch:
        decode_qr_batch_mode()
    elif args.ipc:
        ipc_mode()
    else:
        interactive_mode()


if __name__ == "__main__":
    main()
