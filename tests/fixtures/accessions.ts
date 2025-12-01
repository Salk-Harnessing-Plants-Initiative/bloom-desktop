/**
 * Test Fixtures: Accessions
 *
 * Reusable test data factory functions for creating consistent
 * accession test data across unit and E2E tests.
 */

export interface AccessionTestData {
  name: string;
}

export interface PlantMappingTestData {
  plant_barcode: string;
  genotype_id?: string;
}

export interface ExcelFileTestData {
  sheets: {
    name: string;
    data: Record<string, string | number>[];
  }[];
}

/**
 * Create accession test data with optional overrides
 *
 * @param overrides - Optional fields to override defaults
 * @returns Accession data object suitable for testing
 *
 * @example
 * // Use defaults with unique name
 * const accession = createAccessionData();
 *
 * @example
 * // Override specific fields
 * const accession = createAccessionData({
 *   name: 'Arabidopsis Col-0'
 * });
 */
export function createAccessionData(
  overrides: Partial<AccessionTestData> = {}
): AccessionTestData {
  return {
    // Use timestamp + random number to ensure unique names across parallel tests
    name: `Accession-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    ...overrides,
  };
}

/**
 * Valid accession data (for simple cases)
 */
export const validAccession: AccessionTestData = {
  name: 'Arabidopsis Col-0',
};

/**
 * Maximum length name (255 characters - database schema limit)
 */
export const maxLengthName = 'A'.repeat(255);

/**
 * Name with special characters (hyphen, underscore)
 */
export const specialCharName = 'Col-0_Wild-Type';

/**
 * Name with Unicode characters
 */
export const unicodeName = 'Arabidopsis thaliana Ökotyp';

/**
 * Create multiple accessions for list testing
 *
 * @param count - Number of accessions to create
 * @returns Array of accession data objects
 *
 * @example
 * const accessions = createAccessionList(5);
 */
export function createAccessionList(count: number): AccessionTestData[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Accession ${String.fromCharCode(65 + i)}`, // A, B, C, etc.
  }));
}

/**
 * Accessions in non-alphabetical order (for testing sorting)
 */
export const unsortedAccessions: AccessionTestData[] = [
  { name: 'Zea mays B73' },
  { name: 'Arabidopsis Col-0' },
  { name: 'Medicago truncatula' },
  { name: 'Brachypodium distachyon' },
];

/**
 * Expected alphabetical order of unsortedAccessions
 */
export const sortedAccessions: AccessionTestData[] = [
  { name: 'Arabidopsis Col-0' },
  { name: 'Brachypodium distachyon' },
  { name: 'Medicago truncatula' },
  { name: 'Zea mays B73' },
];

/**
 * Create plant-accession mapping test data
 *
 * @param count - Number of mappings to create
 * @returns Array of plant mapping data objects
 *
 * @example
 * const mappings = mockPlantMappings(100);
 */
export function mockPlantMappings(count: number): PlantMappingTestData[] {
  return Array.from({ length: count }, (_, i) => ({
    plant_barcode: `PLANT-${String(i + 1).padStart(6, '0')}`,
    genotype_id: `GT-${String(i + 1).padStart(4, '0')}`,
  }));
}

/**
 * Create mock Excel file data for testing
 *
 * @param options - Configuration for the Excel file
 * @returns Excel file test data structure
 *
 * @example
 * // Single sheet with default columns
 * const excel = mockExcelFile({ rowCount: 50 });
 *
 * @example
 * // Multiple sheets with custom columns
 * const excel = mockExcelFile({
 *   sheets: [
 *     { name: 'Sheet1', rowCount: 100 },
 *     { name: 'Sheet2', rowCount: 50 }
 *   ],
 *   columns: ['Barcode', 'Genotype', 'PlantID']
 * });
 */
export function mockExcelFile(options: {
  rowCount?: number;
  sheets?: { name: string; rowCount: number }[];
  columns?: string[];
}): ExcelFileTestData {
  const {
    rowCount = 20,
    sheets = [{ name: 'Sheet1', rowCount }],
    columns = ['Plant_Barcode', 'Genotype_ID', 'Notes'],
  } = options;

  return {
    sheets: sheets.map((sheet) => ({
      name: sheet.name,
      data: Array.from({ length: sheet.rowCount }, (_, i) => {
        const row: Record<string, string | number> = {};
        columns.forEach((col) => {
          if (
            col.toLowerCase().includes('barcode') ||
            col.toLowerCase().includes('plant')
          ) {
            row[col] = `PLANT-${String(i + 1).padStart(6, '0')}`;
          } else if (
            col.toLowerCase().includes('genotype') ||
            col.toLowerCase().includes('gt')
          ) {
            row[col] = `GT-${String(i + 1).padStart(4, '0')}`;
          } else if (col.toLowerCase().includes('notes')) {
            row[col] = i % 10 === 0 ? `Test note ${i}` : '';
          } else {
            row[col] = `Value ${i + 1}`;
          }
        });
        return row;
      }),
    })),
  };
}

/**
 * Mock Excel file with multiple sheets (for sheet selection testing)
 */
export const multiSheetExcel: ExcelFileTestData = mockExcelFile({
  sheets: [
    { name: 'Plant_Data', rowCount: 100 },
    { name: 'Metadata', rowCount: 5 },
    { name: 'Summary', rowCount: 10 },
  ],
});

/**
 * Mock Excel file with various column naming conventions
 */
export const variousColumnNamesExcel: ExcelFileTestData = {
  sheets: [
    {
      name: 'Sheet1',
      data: Array.from({ length: 20 }, (_, i) => ({
        'Plant Barcode': `PLANT-${String(i + 1).padStart(6, '0')}`,
        'Genotype ID': `GT-${String(i + 1).padStart(4, '0')}`,
        Date: '2025-01-29',
        Status: 'Active',
      })),
    },
  ],
};

/**
 * Mock Excel file with edge cases (empty cells, special characters)
 */
export const edgeCaseExcel: ExcelFileTestData = {
  sheets: [
    {
      name: 'EdgeCases',
      data: [
        { Plant_Barcode: 'PLANT-000001', Genotype_ID: 'GT-0001' },
        { Plant_Barcode: '', Genotype_ID: 'GT-0002' }, // Empty barcode
        { Plant_Barcode: 'PLANT-000003', Genotype_ID: '' }, // Empty genotype
        { Plant_Barcode: 'PLANT-000004', Genotype_ID: 'GT-0004 (special)' }, // Special chars
        { Plant_Barcode: 'PLANT-000005', Genotype_ID: 'GT-0005' },
      ],
    },
  ],
};

/**
 * Mock large Excel file (for batch processing testing)
 */
export const largeExcelFile: ExcelFileTestData = mockExcelFile({
  rowCount: 500,
  columns: ['Plant_Barcode', 'Genotype_ID'],
});
