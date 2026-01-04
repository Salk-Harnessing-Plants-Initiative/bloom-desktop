/**
 * Test Fixtures: Experiments
 *
 * Reusable test data factory functions for creating consistent
 * experiment test data across unit and E2E tests.
 */

export interface ExperimentTestData {
  name: string;
  species: string;
  scientist_id?: string;
  accession_id?: string;
}

/**
 * Hardcoded species list (matches pilot fix/addnewspecies branch, deduplicated)
 * This list should be kept in sync with the Experiments page dropdown.
 */
export const SPECIES_LIST = [
  'Alfalfa',
  'Amaranth',
  'Arabidopsis',
  'Canola',
  'Lotus',
  'Maize',
  'Medicago',
  'Pennycress',
  'Rice',
  'Sorghum',
  'Soybean',
  'Spinach',
  'Sugar_Beet',
  'Tomato',
  'Wheat',
] as const;

export type Species = (typeof SPECIES_LIST)[number];

/**
 * Create experiment test data with optional overrides
 *
 * @param overrides - Optional fields to override defaults
 * @returns Experiment data object suitable for testing
 *
 * @example
 * // Use defaults with unique name
 * const experiment = createExperimentData();
 *
 * @example
 * // Override specific fields
 * const experiment = createExperimentData({
 *   name: 'Drought Study 2025',
 *   species: 'Arabidopsis'
 * });
 */
export function createExperimentData(
  overrides: Partial<ExperimentTestData> = {}
): ExperimentTestData {
  return {
    // Use timestamp + random number to ensure unique names across parallel tests
    name: `Experiment-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    species: 'Arabidopsis',
    ...overrides,
  };
}

/**
 * Valid experiment data (for simple cases)
 */
export const validExperiment: ExperimentTestData = {
  name: 'Drought Study 2025',
  species: 'Arabidopsis',
};

/**
 * Experiment with all optional fields
 */
export const fullExperiment: ExperimentTestData = {
  name: 'Complete Experiment',
  species: 'Rice',
  scientist_id: 'scientist-123',
  accession_id: 'accession-456',
};

/**
 * Maximum length name (255 characters - database schema limit)
 */
export const maxLengthName = 'A'.repeat(255);

/**
 * Name with special characters
 */
export const specialCharName = 'Drought-2025_Phase-1';

/**
 * Name with Unicode characters
 */
export const unicodeName = 'Étude de sécheresse';

/**
 * Create multiple experiments for list testing
 *
 * @param count - Number of experiments to create
 * @returns Array of experiment data objects
 *
 * @example
 * const experiments = createExperimentList(5);
 */
export function createExperimentList(count: number): ExperimentTestData[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Experiment ${String.fromCharCode(65 + i)}`, // A, B, C, etc.
    species: SPECIES_LIST[i % SPECIES_LIST.length],
  }));
}

/**
 * Experiments in non-alphabetical order (for testing sorting)
 */
export const unsortedExperiments: ExperimentTestData[] = [
  { name: 'Zinc Tolerance Study', species: 'Wheat' },
  { name: 'Arabidopsis Growth', species: 'Arabidopsis' },
  { name: 'Maize Drought', species: 'Maize' },
  { name: 'Beta Test', species: 'Soybean' },
];

/**
 * Expected alphabetical order of unsortedExperiments (by name)
 */
export const sortedExperiments: ExperimentTestData[] = [
  { name: 'Arabidopsis Growth', species: 'Arabidopsis' },
  { name: 'Beta Test', species: 'Soybean' },
  { name: 'Maize Drought', species: 'Maize' },
  { name: 'Zinc Tolerance Study', species: 'Wheat' },
];

/**
 * Experiments with linked scientists (for display testing)
 * Note: scientist_id values are placeholders - actual IDs come from database
 */
export interface ExperimentWithScientistDisplay {
  name: string;
  species: string;
  scientistName: string | null;
}

export const experimentsWithScientists: ExperimentWithScientistDisplay[] = [
  {
    name: 'Drought Study',
    species: 'Arabidopsis',
    scientistName: 'Dr. Jane Smith',
  },
  { name: 'Growth Analysis', species: 'Rice', scientistName: null },
  { name: 'Stress Response', species: 'Maize', scientistName: 'Dr. Bob Brown' },
];

/**
 * Get expected display format for an experiment in the list
 *
 * @param experiment - Experiment data with optional scientist name
 * @returns Formatted string as shown in the UI
 *
 * @example
 * getExperimentDisplayFormat({ name: 'Test', species: 'Arabidopsis', scientistName: 'Dr. Smith' })
 * // Returns: "Arabidopsis - Test (Dr. Smith)"
 *
 * getExperimentDisplayFormat({ name: 'Test', species: 'Arabidopsis', scientistName: null })
 * // Returns: "Arabidopsis - Test (unknown)"
 */
export function getExperimentDisplayFormat(
  experiment: ExperimentWithScientistDisplay
): string {
  const scientistDisplay = experiment.scientistName || 'unknown';
  return `${experiment.species} - ${experiment.name} (${scientistDisplay})`;
}
