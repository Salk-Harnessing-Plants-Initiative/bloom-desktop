/**
 * Validation utilities for scan metadata fields
 *
 * Validates Wave Number and Plant Age as non-negative integers.
 */

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  value?: number;
}

/**
 * Core validation for non-negative integer fields
 */
function validateNonNegativeInteger(
  input: string,
  fieldName: string
): ValidationResult {
  const trimmed = input.trim();

  // Check for empty/required
  if (trimmed === '') {
    return { isValid: false, error: `${fieldName} is required` };
  }

  // Check if it contains a decimal point (reject even "2.0")
  if (trimmed.includes('.')) {
    // Check if negative first
    if (trimmed.startsWith('-')) {
      return { isValid: false, error: `${fieldName} must be 0 or greater` };
    }
    return { isValid: false, error: `${fieldName} must be a whole number` };
  }

  // Parse as integer
  const parsed = parseInt(trimmed, 10);

  // Check if parsing failed (non-numeric input)
  if (isNaN(parsed)) {
    return { isValid: false, error: `${fieldName} must be a whole number` };
  }

  // Check if the string representation differs (e.g., "12a" parses to 12)
  if (parsed.toString() !== trimmed) {
    return { isValid: false, error: `${fieldName} must be a whole number` };
  }

  // Check for negative values
  if (parsed < 0) {
    return { isValid: false, error: `${fieldName} must be 0 or greater` };
  }

  return { isValid: true, value: parsed };
}

/**
 * Validates Wave Number input
 * - Must be a non-negative integer (0 or greater)
 * - Must be a whole number (no decimals)
 * - Must not be empty
 */
export function validateWaveNumber(input: string): ValidationResult {
  return validateNonNegativeInteger(input, 'Wave number');
}

/**
 * Validates Plant Age (Days) input
 * - Must be a non-negative integer (0 or greater)
 * - Must be a whole number (no decimals)
 * - Must not be empty
 */
export function validatePlantAgeDays(input: string): ValidationResult {
  return validateNonNegativeInteger(input, 'Plant age');
}
