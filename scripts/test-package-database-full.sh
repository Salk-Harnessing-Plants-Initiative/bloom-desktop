#!/bin/bash
# Packaged App Database Integration Test (Full)
#
# This script verifies that the database works correctly in the packaged
# Electron application, including:
# - Database initialization
# - All Prisma tables exist
# - Database schema matches expected
# - Foreign key constraints are enabled
#
# Exit codes:
# 0 - Success: Database initialized and schema verified
# 1 - Failure: Database initialization or verification failed

set -e

# Load test utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/test-utils.sh"
source "$SCRIPT_DIR/lib/verify-database.sh"

# Configuration
TIMEOUT=30  # seconds
LOG_FILE="/tmp/bloom-package-test.log"
PLATFORM=$(uname -s)

# Platform-specific app path
if [ "$PLATFORM" = "Darwin" ]; then
  APP_PATH="out/Bloom Desktop-darwin-arm64/Bloom Desktop.app/Contents/MacOS/Bloom Desktop"
  DB_PATH="$HOME/.bloom/data/bloom.db"
elif [ "$PLATFORM" = "Linux" ]; then
  APP_PATH="out/Bloom Desktop-linux-x64/bloom-desktop"
  DB_PATH="$HOME/.bloom/data/bloom.db"
else
  echo "[ERROR] Unsupported platform: $PLATFORM"
  exit 1
fi

echo "========================================="
echo "Packaged App Database Integration Test"
echo "========================================="
echo ""
echo "Platform: $PLATFORM"
echo "App path: $APP_PATH"
echo "Database path: $DB_PATH"
echo "Timeout: ${TIMEOUT}s"
echo ""

# Check if packaged app exists
if [ ! -f "$APP_PATH" ] && [ ! -d "$APP_PATH" ]; then
  echo "[ERROR] Packaged app not found at: $APP_PATH"
  echo "   Run 'npm run package' first"
  exit 1
fi

echo "[PASS] Found packaged app"
echo ""

# Clean up any previous test artifacts
rm -f "$LOG_FILE"
rm -rf "$DB_PATH"

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
    if check_log_for_errors "$LOG_FILE"; then
      :  # No errors, continue
    else
      kill $APP_PID 2>/dev/null || true
      exit 1
    fi
  fi

  sleep 1
  ELAPSED=$((ELAPSED + 1))

  # Show progress every 5 seconds
  show_progress $ELAPSED $TIMEOUT
done

# If initialized, give app a moment to flush database to disk
if [ "$INITIALIZED" = true ]; then
  echo ""
  echo "Database initialized, waiting for file to be written to disk..."
  sleep 3
fi

# Kill the app
echo ""
echo "Stopping app..."
kill $APP_PID 2>/dev/null || true
wait $APP_PID 2>/dev/null || true

echo ""
echo "========================================="
echo "Test Results"
echo "========================================="
echo ""

if [ "$INITIALIZED" != true ]; then
  echo "[FAIL] Timeout: Database did not initialize within ${TIMEOUT}s"
  echo ""
  echo "App output:"
  echo "------------------------"
  cat "$LOG_FILE"
  echo ""
  exit 1
fi

echo "[PASS] Database initialization detected"
echo ""

# Verify database file was created
if [ ! -f "$DB_PATH" ]; then
  echo "[FAIL] Database file not found at: $DB_PATH"
  echo ""
  echo "Logs:"
  echo "------------------------"
  grep -E "\[Database\]" "$LOG_FILE" || true
  exit 1
fi

echo "[PASS] Database file created: $DB_PATH"
echo ""

# Verify database schema
echo "Verifying database schema..."
if verify_schema "$DB_PATH"; then
  echo "[PASS] All expected tables exist"
else
  echo "[FAIL] Database schema verification failed"
  exit 1
fi

echo ""

# Verify foreign keys are enabled
echo "Verifying foreign key constraints..."
if verify_foreign_keys "$DB_PATH"; then
  echo "[PASS] Foreign keys enabled"
else
  echo "[FAIL] Foreign keys not enabled"
  exit 1
fi

echo ""

# Show database info
echo "Database info:"
echo "------------------------"
show_database_info "$DB_PATH"
echo ""

# Show key initialization logs
echo "Initialization logs:"
echo "------------------------"
if grep -q "\[Database\] Production mode" "$LOG_FILE"; then
  echo "  [PASS] Production mode detected"
fi

if grep -q "\[Database\] Created symlink" "$LOG_FILE"; then
  echo "  [PASS] node_modules symlink created"
fi

if grep -q "\[Database\] Initialized at:" "$LOG_FILE"; then
  echo "  [PASS] Database initialized"
  grep "\[Database\] Initialized at:" "$LOG_FILE" | head -1
fi

if grep -q "\[DB\] Registered all database IPC handlers" "$LOG_FILE"; then
  echo "  [PASS] Database handlers registered"
fi

echo ""
echo "[PASS] All tests passed!"
echo ""

exit 0