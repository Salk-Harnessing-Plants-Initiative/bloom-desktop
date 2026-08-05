/**
 * better-sqlite3-based table-existence check, ported from
 * scripts/lib/verify-database.sh's verify_table_exists()/verify_schema().
 * Native and cross-platform, avoiding a dependency on the sqlite3 CLI
 * (not guaranteed to exist on windows-latest CI runners).
 */

import Database from 'better-sqlite3';

// Prisma tables (based on prisma/schema.prisma), matching the list in
// scripts/lib/verify-database.sh's verify_schema().
export const EXPECTED_TABLES = [
  'Scientist',
  'Phenotyper',
  'Accessions',
  'PlantAccessionMappings',
  'Experiment',
  'Scan',
  'Image',
  'GraviScan',
  'GraviScanSession',
  'GraviScanPlateAssignment',
  'GraviImage',
  'GraviScanner',
  'GraviConfig',
  'GraviPlateAccession',
  'GraviPlateSectionMapping',
  '_prisma_migrations',
];

export interface TableVerificationResult {
  allPresent: boolean;
  missingTables: string[];
}

export function verifyDbTables(
  dbPath: string,
  expectedTables: string[] = EXPECTED_TABLES
): TableVerificationResult {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const existingTables = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as { name: string }[]
      ).map((row) => row.name)
    );

    const missingTables = expectedTables.filter(
      (table) => !existingTables.has(table)
    );

    return { allPresent: missingTables.length === 0, missingTables };
  } finally {
    db.close();
  }
}
