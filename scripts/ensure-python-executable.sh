#!/bin/bash
# Ensure Python executable exists
#
# This script checks if the Python executable already exists (e.g., from CI artifact)
# and only builds it if it's missing. This prevents unnecessary rebuilds in CI.

set -e

PYTHON_EXEC="dist/bloom-hardware"

# Add .exe extension on Windows
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
  PYTHON_EXEC="${PYTHON_EXEC}.exe"
fi

if [ -f "$PYTHON_EXEC" ]; then
  echo "Python executable already exists at: $PYTHON_EXEC"
  echo "Skipping build..."
  exit 0
fi

echo "Python executable not found at: $PYTHON_EXEC"
echo "Building Python executable..."
npm run build:python
