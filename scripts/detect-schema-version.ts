/**
 * Schema Version Detection Utility
 *
 * Detects the schema version of a SQLite database by inspecting table columns.
 *
 * Schema versions:
 * - v1 (init): PlantAccessionMappings has accession_id, no genotype_id (matches pilot)
 * - v2 (add_genotype_id): PlantAccessionMappings has genotype_id
 * - v3 (cleanup): PlantAccessionMappings has accession_name, no accession_id
 * - migrated: Database has _prisma_migrations table
 * - unknown: Schema doesn't match any known version
 */

import Database from 'better-sqlite3';

/**
 * Schema version identifiers
 */
export type SchemaVersion = 'v1' | 'v2' | 'v3' | 'migrated' | 'unknown';

/**
 * Column info from SQLite PRAGMA table_info
 */
interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

/**
 * Detect the schema version of a SQLite database.
 *
 * Detection logic:
 * 1. If _prisma_migrations table exists → 'migrated'
 * 2. If PlantAccessionMappings has accession_name (no accession_id) → 'v3'
 * 3. If PlantAccessionMappings has genotype_id → 'v2'
 * 4. If PlantAccessionMappings has accession_id (no genotype_id) → 'v1'
 * 5. Otherwise → 'unknown'
 *
 * @param dbPath Path to the SQLite database file
 * @returns The detected schema version
 * @throws Error if database doesn't exist or PlantAccessionMappings table is missing
 */
export async function detectSchemaVersion(dbPath: string): Promise<SchemaVersion> {
  const db = new Database(dbPath, { readonly: true });

  try {
    // Check if _prisma_migrations table exists
    const migrationTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'"
      )
      .get();

    if (migrationTable) {
      return 'migrated';
    }

    // Check if PlantAccessionMappings table exists
    const mappingsTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='PlantAccessionMappings'"
      )
      .get();

    if (!mappingsTable) {
      throw new Error(
        'PlantAccessionMappings table not found. This may not be a valid Bloom database.'
      );
    }

    // Get columns from PlantAccessionMappings
    const columns = db
      .prepare("PRAGMA table_info('PlantAccessionMappings')")
      .all() as ColumnInfo[];

    const columnNames = new Set(columns.map((c) => c.name));

    // Detection logic based on column presence
    const hasAccessionId = columnNames.has('accession_id');
    const hasGenotypeId = columnNames.has('genotype_id');
    const hasAccessionName = columnNames.has('accession_name');

    // V3: has accession_name, no accession_id
    if (hasAccessionName && !hasAccessionId) {
      return 'v3';
    }

    // V2: has genotype_id (with or without accession_id)
    if (hasGenotypeId) {
      return 'v2';
    }

    // V1: has accession_id, no genotype_id, no accession_name
    if (hasAccessionId && !hasGenotypeId && !hasAccessionName) {
      return 'v1';
    }

    // Unknown schema
    return 'unknown';
  } finally {
    db.close();
  }
}

/**
 * Get detailed schema information for a database.
 * Useful for debugging and logging.
 *
 * @param dbPath Path to the SQLite database file
 * @returns Object with schema details
 */
export async function getSchemaInfo(dbPath: string): Promise<{
  version: SchemaVersion;
  hasMigrationsTable: boolean;
  plantMappingsColumns: string[];
  scanColumns: string[];
}> {
  const db = new Database(dbPath, { readonly: true });

  try {
    const version = await detectSchemaVersion(dbPath);

    // Check for migrations table
    const migrationTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'"
      )
      .get();

    // Get PlantAccessionMappings columns
    let plantMappingsColumns: string[] = [];
    const mappingsTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='PlantAccessionMappings'"
      )
      .get();

    if (mappingsTable) {
      const columns = db
        .prepare("PRAGMA table_info('PlantAccessionMappings')")
        .all() as ColumnInfo[];
      plantMappingsColumns = columns.map((c) => c.name);
    }

    // Get Scan columns
    let scanColumns: string[] = [];
    const scanTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='Scan'"
      )
      .get();

    if (scanTable) {
      const columns = db
        .prepare("PRAGMA table_info('Scan')")
        .all() as ColumnInfo[];
      scanColumns = columns.map((c) => c.name);
    }

    return {
      version,
      hasMigrationsTable: !!migrationTable,
      plantMappingsColumns,
      scanColumns,
    };
  } finally {
    db.close();
  }
}

// CLI support - run directly with ts-node
if (require.main === module) {
  const dbPath = process.argv[2];

  if (!dbPath) {
    console.error('Usage: npx ts-node scripts/detect-schema-version.ts <database-path>');
    process.exit(1);
  }

  detectSchemaVersion(dbPath)
    .then((version) => {
      console.log(`Schema version: ${version}`);
      return getSchemaInfo(dbPath);
    })
    .then((info) => {
      console.log('\nDetailed info:');
      console.log(`  Has migrations table: ${info.hasMigrationsTable}`);
      console.log(`  PlantAccessionMappings columns: ${info.plantMappingsColumns.join(', ')}`);
      console.log(`  Scan columns: ${info.scanColumns.join(', ')}`);
    })
    .catch((err) => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}
