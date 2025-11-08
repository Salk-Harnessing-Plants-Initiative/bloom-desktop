#!/bin/bash
# Database Verification Utilities
#
# Reusable bash functions for verifying SQLite database state.
# These utilities use sqlite3 CLI to introspect database schema
# and data for test validation.

# Verify that a table exists in the database
# Usage: verify_table_exists <db_path> <table_name>
# Returns: 0 if table exists, 1 if not
verify_table_exists() {
  local db_path="$1"
  local table_name="$2"

  if [ ! -f "$db_path" ]; then
    echo "[ERROR] Database not found: $db_path"
    return 1
  fi

  local result=$(sqlite3 "$db_path" "SELECT name FROM sqlite_master WHERE type='table' AND name='$table_name';")

  if [ -z "$result" ]; then
    echo "[ERROR] Table not found: $table_name"
    return 1
  fi

  return 0
}

# Count records in a table
# Usage: verify_record_count <db_path> <table_name> <expected_count>
# Returns: 0 if count matches, 1 if not
verify_record_count() {
  local db_path="$1"
  local table_name="$2"
  local expected_count="$3"

  if [ ! -f "$db_path" ]; then
    echo "[ERROR] Database not found: $db_path"
    return 1
  fi

  local actual_count=$(sqlite3 "$db_path" "SELECT COUNT(*) FROM $table_name;")

  if [ "$actual_count" != "$expected_count" ]; then
    echo "[ERROR] Record count mismatch in $table_name: expected $expected_count, got $actual_count"
    return 1
  fi

  return 0
}

# Verify foreign key constraints are enabled
# Usage: verify_foreign_keys <db_path>
# Returns: 0 if enabled, 1 if not
verify_foreign_keys() {
  local db_path="$1"

  if [ ! -f "$db_path" ]; then
    echo "[ERROR] Database not found: $db_path"
    return 1
  fi

  local fk_enabled=$(sqlite3 "$db_path" "PRAGMA foreign_keys;")

  if [ "$fk_enabled" != "1" ]; then
    echo "[ERROR] Foreign keys not enabled (got: $fk_enabled)"
    return 1
  fi

  return 0
}

# Verify database schema includes all expected Prisma tables
# Usage: verify_schema <db_path>
# Returns: 0 if all tables exist, 1 if any missing
verify_schema() {
  local db_path="$1"

  if [ ! -f "$db_path" ]; then
    echo "[ERROR] Database not found: $db_path"
    return 1
  fi

  # Prisma tables (based on schema.prisma)
  local expected_tables=(
    "Scientist"
    "Phenotyper"
    "Accession"
    "Experiment"
    "Scan"
    "Image"
    "_prisma_migrations"
  )

  local all_exist=true

  for table in "${expected_tables[@]}"; do
    if ! verify_table_exists "$db_path" "$table" > /dev/null 2>&1; then
      echo "[ERROR] Missing table: $table"
      all_exist=false
    fi
  done

  if [ "$all_exist" = false ]; then
    echo ""
    echo "Available tables:"
    sqlite3 "$db_path" "SELECT name FROM sqlite_master WHERE type='table';"
    return 1
  fi

  return 0
}

# Get list of all tables in database
# Usage: list_tables <db_path>
# Returns: List of table names, one per line
list_tables() {
  local db_path="$1"

  if [ ! -f "$db_path" ]; then
    echo "[ERROR] Database not found: $db_path"
    return 1
  fi

  sqlite3 "$db_path" "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
}

# Display database info for debugging
# Usage: show_database_info <db_path>
show_database_info() {
  local db_path="$1"

  if [ ! -f "$db_path" ]; then
    echo "[ERROR] Database not found: $db_path"
    return 1
  fi

  echo "Database: $db_path"
  echo "Size: $(du -h "$db_path" | cut -f1)"
  echo ""
  echo "Tables:"
  list_tables "$db_path"
  echo ""
  echo "Foreign keys enabled: $(sqlite3 "$db_path" "PRAGMA foreign_keys;")"
}