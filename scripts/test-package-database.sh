#!/bin/bash
# Test Packaged App Database Integration
#
# This script verifies that the database initializes correctly in the packaged
# Electron application. It's designed to run in CI to catch Prisma packaging issues.
#
# What it tests:
# - Packaged app launches successfully
# - Database initializes with Prisma Client
# - node_modules symlink is created for Prisma resolution
# - Database handlers are registered
# - No critical errors during initialization
#
# Exit codes:
# 0 - Success: Database initialized correctly
# 1 - Failure: Database initialization failed or errors detected

set -e

# Configuration
TIMEOUT=30  # seconds
LOG_FILE="/tmp/bloom-package-test.log"
PLATFORM=$(uname -s)

# Platform-specific app path
if [ "$PLATFORM" = "Darwin" ]; then
  APP_PATH="out/Bloom Desktop-darwin-arm64/Bloom Desktop.app/Contents/MacOS/Bloom Desktop"
elif [ "$PLATFORM" = "Linux" ]; then
  APP_PATH="out/Bloom Desktop-linux-x64/bloom-desktop"
else
  echo "❌ Unsupported platform: $PLATFORM"
  exit 1
fi

echo "========================================="
echo "Packaged App Database Integration Test"
echo "========================================="
echo ""
echo "Platform: $PLATFORM"
echo "App path: $APP_PATH"
echo "Timeout: ${TIMEOUT}s"
echo ""

# Check if packaged app exists
if [ ! -f "$APP_PATH" ] && [ ! -d "$APP_PATH" ]; then
  echo "❌ Packaged app not found at: $APP_PATH"
  echo "   Run 'npm run package' first"
  exit 1
fi

echo "✓ Found packaged app"
echo ""

# Clean up any previous test artifacts
rm -f "$LOG_FILE"
rm -rf ~/.bloom/data/bloom.db

# Launch packaged app and capture output
echo "Launching packaged app..."
echo "(This will run for ${TIMEOUT} seconds and then exit)"
echo ""

# Run app in background and capture output
"$APP_PATH" > "$LOG_FILE" 2>&1 &
APP_PID=$!

# Wait for app to initialize (max TIMEOUT seconds)
echo "Waiting for database initialization..."
ELAPSED=0
INITIALIZED=false

while [ $ELAPSED -lt $TIMEOUT ]; do
  if [ -f "$LOG_FILE" ]; then
    # Check for successful initialization
    if grep -q "\[Main\] Database initialized and handlers registered" "$LOG_FILE"; then
      INITIALIZED=true
      break
    fi

    # Check for critical errors
    if grep -q "\[Main\] Failed to initialize database" "$LOG_FILE"; then
      echo "❌ Database initialization failed!"
      echo ""
      echo "Error details:"
      grep -A 10 "\[Main\] Failed to initialize database" "$LOG_FILE"
      kill $APP_PID 2>/dev/null || true
      exit 1
    fi
  fi

  sleep 1
  ELAPSED=$((ELAPSED + 1))

  # Show progress every 5 seconds
  if [ $((ELAPSED % 5)) -eq 0 ]; then
    echo "  ... waiting (${ELAPSED}s elapsed)"
  fi
done

# Kill the app
kill $APP_PID 2>/dev/null || true
wait $APP_PID 2>/dev/null || true

echo ""
echo "========================================="
echo "Test Results"
echo "========================================="
echo ""

if [ "$INITIALIZED" = true ]; then
  echo "✅ SUCCESS: Database initialized correctly!"
  echo ""
  echo "Key events detected:"

  # Show key initialization logs
  if grep -q "\[Database\] Production mode" "$LOG_FILE"; then
    echo "  ✓ Production mode detected"
  fi

  if grep -q "\[Database\] Created symlink" "$LOG_FILE"; then
    echo "  ✓ node_modules symlink created"
  fi

  if grep -q "\[Database\] Initialized at:" "$LOG_FILE"; then
    echo "  ✓ Database initialized"
    grep "\[Database\] Initialized at:" "$LOG_FILE" | head -1
  fi

  if grep -q "\[DB\] Registered all database IPC handlers" "$LOG_FILE"; then
    echo "  ✓ Database handlers registered"
  fi

  echo ""
  echo "Full initialization logs:"
  echo "------------------------"
  grep -E "\[Main\]|\[Database\]|\[DB\]" "$LOG_FILE" || true
  echo ""

  exit 0
else
  echo "❌ FAILURE: Database did not initialize within ${TIMEOUT} seconds"
  echo ""
  echo "App output:"
  echo "------------------------"
  cat "$LOG_FILE"
  echo ""

  exit 1
fi
