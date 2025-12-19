/**
 * Generate Excel test fixtures for E2E tests
 *
 * Run with: npx ts-node tests/fixtures/excel/generate-test-files.ts
 */

import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

const FIXTURES_DIR = path.join(__dirname);

// Single sheet with plant mappings
function createSingleSheetFile() {
  const data = [
    ['PlantBarcode', 'GenotypeID', 'Notes'],
    ['PLANT001', 'GT-A001', 'Control group'],
    ['PLANT002', 'GT-A002', 'Treatment 1'],
    ['PLANT003', 'GT-A003', 'Treatment 2'],
    ['PLANT004', 'GT-A001', 'Control group'],
    ['PLANT005', 'GT-B001', 'Wild type'],
    ['PLANT006', 'GT-B002', 'Mutant'],
    ['PLANT007', 'GT-C001', 'Hybrid'],
    ['PLANT008', 'GT-C002', 'Hybrid'],
    ['PLANT009', 'GT-A003', 'Treatment 2'],
    ['PLANT010', 'GT-B001', 'Wild type'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mappings');
  XLSX.writeFile(wb, path.join(FIXTURES_DIR, 'single-sheet.xlsx'));
  console.log('Created: single-sheet.xlsx');
}

// Multi-sheet file with different data on each sheet
function createMultiSheetFile() {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Batch A
  const batchA = [
    ['Plant_ID', 'Genotype', 'Batch'],
    ['PA-001', 'GEN-X1', 'A'],
    ['PA-002', 'GEN-X2', 'A'],
    ['PA-003', 'GEN-X3', 'A'],
    ['PA-004', 'GEN-X1', 'A'],
    ['PA-005', 'GEN-X2', 'A'],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(batchA);
  XLSX.utils.book_append_sheet(wb, ws1, 'Batch_A');

  // Sheet 2: Batch B
  const batchB = [
    ['QRCode', 'AccessionID', 'Date'],
    ['PB-001', 'ACC-Y1', '2025-01-01'],
    ['PB-002', 'ACC-Y2', '2025-01-02'],
    ['PB-003', 'ACC-Y3', '2025-01-03'],
    ['PB-004', 'ACC-Y1', '2025-01-04'],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(batchB);
  XLSX.utils.book_append_sheet(wb, ws2, 'Batch_B');

  // Sheet 3: Summary (no plant data)
  const summary = [['Summary'], ['Total Plants: 9'], ['Total Genotypes: 6']];
  const ws3 = XLSX.utils.aoa_to_sheet(summary);
  XLSX.utils.book_append_sheet(wb, ws3, 'Summary');

  XLSX.writeFile(wb, path.join(FIXTURES_DIR, 'multi-sheet.xlsx'));
  console.log('Created: multi-sheet.xlsx');
}

// File with many rows for batch processing test
function createLargeFile() {
  const data: (string | number)[][] = [['Barcode', 'Genotype', 'Index']];

  // Create 250 rows to test batch processing (100 rows per batch)
  for (let i = 1; i <= 250; i++) {
    data.push([`PLANT-${String(i).padStart(4, '0')}`, `GT-${i % 50}`, i]);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'LargeBatch');
  XLSX.writeFile(wb, path.join(FIXTURES_DIR, 'large-batch.xlsx'));
  console.log('Created: large-batch.xlsx (250 rows)');
}

// File with empty cells and edge cases
function createEdgeCasesFile() {
  const data = [
    ['PlantCode', 'GenotypeRef', 'Status'],
    ['EDGE001', 'GT-001', 'Active'],
    ['EDGE002', '', 'Missing genotype'], // Empty genotype
    ['', 'GT-003', 'Missing plant'], // Empty plant
    ['EDGE004', 'GT-004', ''], // Empty status (should still work)
    ['EDGE005', 'GT-005', 'Active'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'EdgeCases');
  XLSX.writeFile(wb, path.join(FIXTURES_DIR, 'edge-cases.xlsx'));
  console.log('Created: edge-cases.xlsx');
}

// File with different column names (to test column mapping flexibility)
function createAlternativeColumnsFile() {
  const data = [
    ['Sample_Barcode', 'Accession_Number', 'Experiment', 'Date_Collected'],
    ['SB-001', 'AN-100', 'EXP-A', '2025-01-15'],
    ['SB-002', 'AN-101', 'EXP-A', '2025-01-15'],
    ['SB-003', 'AN-102', 'EXP-B', '2025-01-16'],
    ['SB-004', 'AN-100', 'EXP-B', '2025-01-16'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Samples');
  XLSX.writeFile(wb, path.join(FIXTURES_DIR, 'alternative-columns.xlsx'));
  console.log('Created: alternative-columns.xlsx');
}

// Create all test files
function main() {
  console.log('Generating Excel test fixtures...\n');

  createSingleSheetFile();
  createMultiSheetFile();
  createLargeFile();
  createEdgeCasesFile();
  createAlternativeColumnsFile();

  console.log('\nAll test fixtures created in:', FIXTURES_DIR);

  // List generated files
  const files = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.xlsx'));
  console.log('Files:', files);
}

main();
