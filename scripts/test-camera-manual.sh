#!/bin/bash
# Manual test script for camera functionality

echo "============================================================"
echo "Manual Camera Test (Mock Camera)"
echo "============================================================"
echo ""

PYTHON_EXE="./dist/bloom-hardware"

if [ ! -f "$PYTHON_EXE" ]; then
    echo "ERROR: Python executable not found at $PYTHON_EXE"
    echo "Run: npm run build:python"
    exit 1
fi

echo "Testing camera status..."
echo '{"command":"camera","action":"status"}' | $PYTHON_EXE --ipc
echo ""

echo "Testing camera connect..."
echo '{"command":"camera","action":"connect","settings":{"camera_ip_address":"10.0.0.23","exposure_time":5000,"gain":10,"gamma":1.0}}' | $PYTHON_EXE --ipc
echo ""

echo "Testing camera capture..."
echo '{"command":"camera","action":"capture","settings":{"camera_ip_address":"10.0.0.23","exposure_time":5000,"gain":10}}' | $PYTHON_EXE --ipc | head -5
echo "(image data truncated...)"
echo ""

echo "============================================================"
echo "Manual test complete!"
echo "============================================================"
echo ""
echo "For more testing options, see: docs/CAMERA_TESTING.md"