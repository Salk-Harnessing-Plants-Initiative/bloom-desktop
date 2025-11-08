#!/bin/bash
# Database Test Utilities
#
# Reusable bash functions for testing Electron database functionality.
# These utilities provide consistent log monitoring and error detection
# across dev mode and packaged app tests.

# Wait for a specific pattern to appear in a log file
# Usage: wait_for_log_pattern <log_file> <pattern> <timeout_seconds>
# Returns: 0 if pattern found, 1 if timeout
wait_for_log_pattern() {
  local log_file="$1"
  local pattern="$2"
  local timeout="$3"
  local elapsed=0

  while [ $elapsed -lt "$timeout" ]; do
    if [ -f "$log_file" ]; then
      if grep -q "$pattern" "$log_file"; then
        return 0
      fi
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

# Check if log file contains any error patterns
# Usage: check_log_for_errors <log_file>
# Returns: 0 if no errors found, 1 if errors detected
check_log_for_errors() {
  local log_file="$1"

  if [ ! -f "$log_file" ]; then
    echo "Log file not found: $log_file"
    return 1
  fi

  # Check for common error patterns
  if grep -q "\[Main\] Failed to initialize database" "$log_file"; then
    echo "❌ Database initialization failed"
    grep -A 10 "\[Main\] Failed to initialize database" "$log_file"
    return 1
  fi

  if grep -q "Error: " "$log_file" | grep -v "deprecated" | grep -v "warning"; then
    echo "❌ Errors detected in logs"
    grep "Error: " "$log_file" | grep -v "deprecated" | grep -v "warning" | head -10
    return 1
  fi

  return 0
}

# Extract database path from log file
# Usage: extract_database_path <log_file>
# Returns: Database path string or empty string if not found
extract_database_path() {
  local log_file="$1"

  if [ ! -f "$log_file" ]; then
    echo ""
    return 1
  fi

  # Look for database initialization log
  local db_path=$(grep "\[Database\] Initialized at:" "$log_file" | sed 's/.*Initialized at: //' | head -1)

  echo "$db_path"
}

# Display progress dots while waiting
# Usage: show_progress <seconds_elapsed> <total_seconds>
show_progress() {
  local elapsed="$1"
  local total="$2"

  if [ $((elapsed % 5)) -eq 0 ] && [ $elapsed -gt 0 ]; then
    echo "  ... waiting (${elapsed}s / ${total}s elapsed)"
  fi
}