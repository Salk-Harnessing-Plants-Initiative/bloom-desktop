#!/usr/bin/env python3
"""
Bloom Hardware Interface
Entry point for the Python hardware control backend.

Can run in two modes:
  1. IPC mode (--ipc): JSON-based stdin/stdout communication for Electron
  2. Interactive mode (default): Human-friendly CLI for testing
"""

import sys
import platform
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
        print(f"[OK] PyPylon available")
    except ImportError as e:
        print(f"[FAIL] PyPylon: {e}")

    try:
        import nidaqmx
        print(f"[OK] NI-DAQmx available")
    except ImportError as e:
        print(f"[FAIL] NI-DAQmx: {e}")

    print("=" * 50)
    print("Ready. Type 'exit' to quit.")
    print("=" * 50)

    # Simple command loop
    while True:
        try:
            cmd = input("> ").strip()
            if cmd.lower() in ('exit', 'quit'):
                print("Shutting down...")
                break
            elif cmd.lower() == 'help':
                print("Available commands: help, exit, version")
            elif cmd.lower() == 'version':
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
        from ipc_handler import run_ipc_loop
    run_ipc_loop()


def main():
    """Main entry point - routes to interactive or IPC mode."""
    parser = argparse.ArgumentParser(description="Bloom Hardware Interface")
    parser.add_argument(
        "--ipc",
        action="store_true",
        help="Run in IPC mode for Electron communication"
    )
    args = parser.parse_args()

    if args.ipc:
        ipc_mode()
    else:
        interactive_mode()


if __name__ == "__main__":
    main()
