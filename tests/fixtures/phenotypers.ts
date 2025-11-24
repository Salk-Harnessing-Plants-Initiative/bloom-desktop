/**
 * Test Fixtures: Phenotypers
 *
 * Reusable test data factory functions for creating consistent
 * phenotyper test data across unit and E2E tests.
 */

export interface PhenotyperTestData {
  name: string;
  email: string;
}

/**
 * Create phenotyper test data with optional overrides
 *
 * @param overrides - Optional fields to override defaults
 * @returns Phenotyper data object suitable for testing
 *
 * @example
 * // Use defaults
 * const phenotyper = createPhenotyperData();
 *
 * @example
 * // Override specific fields
 * const phenotyper = createPhenotyperData({
 *   name: 'Custom Name',
 *   email: 'custom@example.com'
 * });
 */
export function createPhenotyperData(
  overrides: Partial<PhenotyperTestData> = {}
): PhenotyperTestData {
  return {
    name: 'Test Phenotyper',
    // Use timestamp + random number to ensure unique emails across parallel tests
    email: `phenotyper-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`,
    ...overrides,
  };
}

/**
 * Valid phenotyper data (for simple cases)
 */
export const validPhenotyper: PhenotyperTestData = {
  name: 'John Smith',
  email: 'john.smith@example.com',
};

/**
 * Maximum length name (255 characters - database schema limit)
 */
export const maxLengthName = 'A'.repeat(255);

/**
 * Name with special characters (apostrophe, hyphen)
 */
export const specialCharName = "O'Brien-Smith";

/**
 * Name with Unicode characters
 */
export const unicodeName = 'José García';

/**
 * Email with subdomain
 */
export const subdomainEmail = 'user@test.example.com';

/**
 * Create multiple phenotypers for list testing
 *
 * @param count - Number of phenotypers to create
 * @returns Array of phenotyper data objects
 *
 * @example
 * const phenotypers = createPhenotyperList(5);
 */
export function createPhenotyperList(count: number): PhenotyperTestData[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Phenotyper ${String.fromCharCode(65 + i)}`, // A, B, C, etc.
    email: `phenotyper${i}@example.com`,
  }));
}

/**
 * Phenotypers in non-alphabetical order (for testing sorting)
 */
export const unsortedPhenotypers: PhenotyperTestData[] = [
  { name: 'Zoe Zhang', email: 'zoe.zhang@example.com' },
  { name: 'Alice Anderson', email: 'alice.anderson@example.com' },
  { name: 'Mike Miller', email: 'mike.miller@example.com' },
  { name: 'Bob Brown', email: 'bob.brown@example.com' },
];

/**
 * Expected alphabetical order of unsortedPhenotypers
 */
export const sortedPhenotypers: PhenotyperTestData[] = [
  { name: 'Alice Anderson', email: 'alice.anderson@example.com' },
  { name: 'Bob Brown', email: 'bob.brown@example.com' },
  { name: 'Mike Miller', email: 'mike.miller@example.com' },
  { name: 'Zoe Zhang', email: 'zoe.zhang@example.com' },
];