#!/usr/bin/env python3
"""
Bloom Hardware Interface
Entry point for the Python hardware control backend.
"""

import sys
import platform


def main():
    """Main entry point for the hardware interface."""
    print("=" * 50)
    print("Bloom Hardware Interface")
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


if __name__ == "__main__":
    main()
