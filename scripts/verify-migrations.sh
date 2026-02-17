#!/bin/bash
#
# Migration Verification Script
#
# Verifies that Prisma migrations produce a schema equivalent to `prisma db push`.
# This ensures migrations stay in sync with the schema.prisma file.
#
# Usage:
#   ./scripts/verify-migrations.sh
#
# Exit codes:
#   0 - Migrations match schema
#   1 - Schema mismatch (migrations out of sync)
#   2 - Script error

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=== Prisma Migration Verification ==="
echo ""

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

MIGRATE_DB="$TEMP_DIR/migrate.db"
PUSH_DB="$TEMP_DIR/push.db"
MIGRATE_SCHEMA="$TEMP_DIR/migrate.schema"
PUSH_SCHEMA="$TEMP_DIR/push.schema"

echo "Creating database using prisma migrate deploy..."
BLOOM_DATABASE_URL="file:$MIGRATE_DB" npx prisma migrate deploy 2>/dev/null
echo -e "${GREEN}✓${NC} Migration database created"

echo ""
echo "Creating database using prisma db push..."
BLOOM_DATABASE_URL="file:$PUSH_DB" npx prisma db push --accept-data-loss 2>/dev/null
echo -e "${GREEN}✓${NC} Push database created"

echo ""
echo "Extracting schemas..."

# Extract schema from both databases, excluding _prisma_migrations table
# Use SQL to list all tables except _prisma_migrations, then get their schemas

extract_schema() {
  local db_path="$1"
  local output_file="$2"

  # Get list of tables (excluding _prisma_migrations and sqlite internal tables)
  tables=$(sqlite3 "$db_path" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name;")

  # Get schema for each table
  for table in $tables; do
    sqlite3 "$db_path" "SELECT sql || ';' FROM sqlite_master WHERE type='table' AND name='$table';"
    # Also get indexes for this table
    sqlite3 "$db_path" "SELECT sql || ';' FROM sqlite_master WHERE type='index' AND tbl_name='$table' AND sql IS NOT NULL;"
  done | sort > "$output_file"
}

extract_schema "$MIGRATE_DB" "$MIGRATE_SCHEMA"
extract_schema "$PUSH_DB" "$PUSH_SCHEMA"

echo ""
echo "Comparing schemas..."

# Compare schemas
if diff -q "$MIGRATE_SCHEMA" "$PUSH_SCHEMA" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Schemas match!${NC}"
    echo ""
    echo "Prisma migrations are in sync with schema.prisma"
    exit 0
else
    echo -e "${RED}✗ Schema mismatch detected!${NC}"
    echo ""
    echo "Differences found between migrate deploy and db push:"
    echo ""
    diff "$MIGRATE_SCHEMA" "$PUSH_SCHEMA" || true
    echo ""
    echo -e "${YELLOW}To fix this, run:${NC}"
    echo "  npx prisma migrate dev --name <migration-name>"
    echo ""
    echo "This will create a new migration to sync the schema."
    exit 1
fi
