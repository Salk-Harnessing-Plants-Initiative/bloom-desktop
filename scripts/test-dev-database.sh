#!/bin/bash
# Dev Mode Database Integration Test
#
# Tests that the database initializes correctly when running the Electron app
# in development mode via electron-forge start. This validates that:
# - Database is created at ./prisma/dev.db
# - Prisma Client loads from node_modules (no symlink needed)
# - Database handlers register successfully
# - No initialization errors occur
#
# Exit codes:
# 0 - Success: Database initialized correctly in dev mode
# 1 - Failure: Database initialization failed or timeout

set -e

# Load test utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/test-utils.sh"

# Configuration
TIMEOUT=60  # Dev mode is slower, needs more time
LOG_FILE="/tmp/bloom-dev-database-test.log"
DEV_DB_PATH="./prisma/dev.db"

echo "========================================="
echo "Dev Mode Database Integration Test"
echo "========================================="
echo ""
echo "Timeout: ${TIMEOUT}s"
echo "Log file: $LOG_FILE"
echo "Expected database: $DEV_DB_PATH"
echo ""

# Clean up previous test artifacts
rm -f "$LOG_FILE"
rm -f "$DEV_DB_PATH"

echo "Launching Electron app in dev mode..."
echo "(App will run in background, monitoring logs)"
echo ""

# Launch electron-forge start in background
# ELECTRON_DISABLE_SANDBOX=1 is required for CI environments
ELECTRON_DISABLE_SANDBOX=1 npm run start > "$LOG_FILE" 2>&1 &
APP_PID=$!

echo "App launched (PID: $APP_PID)"
echo ""

# Wait for database initialization
echo "Waiting for database initialization..."
ELAPSED=0

while [ $ELAPSED -lt $TIMEOUT ]; do
  # Check if log file exists and has content
  if [ -f "$LOG_FILE" ]; then
    # Check for successful initialization
    if grep -q "\[Main\] Database initialized and handlers registered" "$LOG_FILE"; then
      echo "SUCCESS: Database initialization detected!"
      break
    fi

    # Check for initialization failure
    if grep -q "\[Main\] Failed to initialize database" "$LOG_FILE"; then
      echo "[ERROR] Database initialization failed!"
      echo ""
      echo "Error details:"
      grep -A 10 "\[Main\] Failed to initialize database" "$LOG_FILE"
      kill $APP_PID 2>/dev/null || true
      wait $APP_PID 2>/dev/null || true
      exit 1
    fi

    # Check for critical errors
    if check_log_for_errors "$LOG_FILE"; then
      :  # No errors found, continue
    else
      kill $APP_PID 2>/dev/null || true
      wait $APP_PID 2>/dev/null || true
      exit 1
    fi
  fi

  sleep 1
  ELAPSED=$((ELAPSED + 1))

  # Show progress every 5 seconds
  show_progress $ELAPSED $TIMEOUT
done

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

# Verify database was created
if [ ! -f "$DEV_DB_PATH" ]; then
  echo "[FAIL] Database file not found at: $DEV_DB_PATH"
  echo ""
  echo "App logs:"
  echo "------------------------"
  tail -50 "$LOG_FILE"
  exit 1
fi

echo "[PASS] Database file created: $DEV_DB_PATH"
echo "[PASS] Database initialized successfully"
echo ""

# Show key initialization logs
echo "Initialization logs:"
echo "------------------------"
grep -E "\[Main\]|\[Database\]|\[DB\]" "$LOG_FILE" | head -20 || true
echo ""

# Verify initialization message appeared
if grep -q "\[Main\] Database initialized and handlers registered" "$LOG_FILE"; then
  echo "[PASS] All tests passed!"
  echo ""
  exit 0
else
  echo "[FAIL] Timeout: Database did not initialize within ${TIMEOUT}s"
  echo ""
  echo "Last 30 lines of logs:"
  echo "------------------------"
  tail -30 "$LOG_FILE"
  echo ""
  exit 1
fi