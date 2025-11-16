/**
 * Test Fixtures: Scientists
 *
 * Reusable test data factory functions for creating consistent
 * scientist test data across unit and E2E tests.
 */

export interface ScientistTestData {
  name: string;
  email: string;
}

/**
 * Create scientist test data with optional overrides
 *
 * @param overrides - Optional fields to override defaults
 * @returns Scientist data object suitable for testing
 *
 * @example
 * // Use defaults
 * const scientist = createScientistData();
 *
 * @example
 * // Override specific fields
 * const scientist = createScientistData({
 *   name: 'Dr. Custom Name',
 *   email: 'custom@example.com'
 * });
 */
export function createScientistData(
  overrides: Partial<ScientistTestData> = {}
): ScientistTestData {
  return {
    name: 'Dr. Test Scientist',
    // Use timestamp to ensure unique emails across tests
    email: `test-${Date.now()}@example.com`,
    ...overrides,
  };
}

/**
 * Valid scientist data (for simple cases)
 */
export const validScientist: ScientistTestData = {
  name: 'Dr. Jane Smith',
  email: 'jane.smith@example.com',
};

/**
 * Maximum length name (255 characters - database schema limit)
 */
export const maxLengthName = 'A'.repeat(255);

/**
 * Name with special characters (apostrophe, hyphen)
 */
export const specialCharName = "Dr. O'Brien-Smith";

/**
 * Name with Unicode characters
 */
export const unicodeName = 'Dr. Müller';

/**
 * Email with subdomain
 */
export const subdomainEmail = 'user@test.example.com';

/**
 * Create multiple scientists for list testing
 *
 * @param count - Number of scientists to create
 * @returns Array of scientist data objects
 *
 * @example
 * const scientists = createScientistList(5);
 */
export function createScientistList(count: number): ScientistTestData[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Scientist ${String.fromCharCode(65 + i)}`, // A, B, C, etc.
    email: `scientist${i}@example.com`,
  }));
}

/**
 * Scientists in non-alphabetical order (for testing sorting)
 */
export const unsortedScientists: ScientistTestData[] = [
  { name: 'Dr. Zoe Zhang', email: 'zoe.zhang@example.com' },
  { name: 'Dr. Alice Anderson', email: 'alice.anderson@example.com' },
  { name: 'Dr. Mike Miller', email: 'mike.miller@example.com' },
  { name: 'Dr. Bob Brown', email: 'bob.brown@example.com' },
];

/**
 * Expected alphabetical order of unsortedScientists
 */
export const sortedScientists: ScientistTestData[] = [
  { name: 'Dr. Alice Anderson', email: 'alice.anderson@example.com' },
  { name: 'Dr. Bob Brown', email: 'bob.brown@example.com' },
  { name: 'Dr. Mike Miller', email: 'mike.miller@example.com' },
  { name: 'Dr. Zoe Zhang', email: 'zoe.zhang@example.com' },
];