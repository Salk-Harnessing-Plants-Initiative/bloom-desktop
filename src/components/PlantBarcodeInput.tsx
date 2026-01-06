/**
 * PlantBarcodeInput Component
 *
 * Text input with autocomplete for plant barcodes.
 * Features:
 * - Sanitizes input (replaces + and spaces with _, strips other special chars)
 * - Shows autocomplete dropdown with matching barcodes from experiment's accession
 * - Validates barcode against accession's plant barcodes
 * - Auto-populates genotype ID via callback when valid barcode is selected
 * - Supports keyboard navigation (arrow keys, enter, escape)
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export interface PlantBarcodeInputProps {
  /** Current barcode value */
  value: string;
  /** Callback when barcode changes */
  onChange: (barcode: string) => void;
  /** Callback when genotype ID is found for the barcode */
  onGenotypeIdFound?: (genotypeId: string | null) => void;
  /** Callback when validation state changes */
  onValidationChange?: (isValid: boolean, error?: string) => void;
  /** The selected experiment ID (used to get accession) */
  experimentId: string | null;
  /** The accession ID from the experiment (passed from parent) */
  accessionId: string | null;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** ID for the input element (for label association) */
  id?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Sanitizes plant barcode input:
 * - Replaces + and spaces with underscores
 * - Strips all characters except alphanumerics, underscores, and dashes
 */
export function sanitizePlantBarcode(input: string): string {
  // Step 1: Replace + and spaces with underscores
  let sanitized = input.replace(/[+ ]/g, '_');

  // Step 2: Strip characters that are not alphanumeric, underscore, or dash
  sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, '');

  return sanitized;
}

export function PlantBarcodeInput({
  value,
  onChange,
  onGenotypeIdFound,
  onValidationChange,
  experimentId,
  accessionId,
  disabled = false,
  id,
  placeholder = 'e.g., PLANT_001',
  className = '',
}: PlantBarcodeInputProps) {
  // State for autocomplete
  const [plantBarcodes, setPlantBarcodes] = useState<string[]>([]);
  const [filteredBarcodes, setFilteredBarcodes] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);

  // State for validation
  const [validationError, setValidationError] = useState<string | null>(null);

  // Refs
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const blurTimeoutRef = useRef<number | null>(null);

  // Fetch plant barcodes when accession changes
  useEffect(() => {
    const fetchPlantBarcodes = async () => {
      if (!accessionId) {
        setPlantBarcodes([]);
        return;
      }

      setIsLoading(true);
      try {
        const result =
          await window.electron.database.accessions.getPlantBarcodes(
            accessionId
          );
        if (result.success && result.data) {
          setPlantBarcodes(result.data);
        } else {
          setPlantBarcodes([]);
        }
      } catch (error) {
        console.error('Failed to fetch plant barcodes:', error);
        setPlantBarcodes([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPlantBarcodes();
  }, [accessionId]);

  // Filter barcodes based on current input
  useEffect(() => {
    if (!value.trim() || plantBarcodes.length === 0) {
      setFilteredBarcodes([]);
      return;
    }

    const lowerValue = value.toLowerCase();
    const matches = plantBarcodes
      .filter((barcode) => barcode.toLowerCase().includes(lowerValue))
      .slice(0, 5); // Limit to 5 suggestions

    setFilteredBarcodes(matches);
  }, [value, plantBarcodes]);

  // Validate barcode against accession
  const validateBarcode = useCallback(
    (barcode: string) => {
      // Skip validation if no accession (user can enter any barcode)
      if (!accessionId || plantBarcodes.length === 0) {
        setValidationError(null);
        onValidationChange?.(true);
        return true;
      }

      // Empty barcode - no error yet (required validation handled elsewhere)
      if (!barcode.trim()) {
        setValidationError(null);
        onValidationChange?.(true);
        return true;
      }

      // Check if barcode exists in accession
      const isValid = plantBarcodes.some(
        (pb) => pb.toLowerCase() === barcode.toLowerCase()
      );

      if (isValid) {
        setValidationError(null);
        onValidationChange?.(true);
        return true;
      } else {
        const error = 'Barcode not found in accession file';
        setValidationError(error);
        onValidationChange?.(false, error);
        return false;
      }
    },
    [accessionId, plantBarcodes, onValidationChange]
  );

  // Look up genotype ID when barcode changes
  useEffect(() => {
    const lookupGenotypeId = async () => {
      if (!experimentId || !value.trim()) {
        onGenotypeIdFound?.(null);
        return;
      }

      try {
        const result =
          await window.electron.database.accessions.getGenotypeByBarcode(
            value,
            experimentId
          );
        if (result.success) {
          onGenotypeIdFound?.(result.data ?? null);
        } else {
          onGenotypeIdFound?.(null);
        }
      } catch (error) {
        console.error('Failed to look up genotype ID:', error);
        onGenotypeIdFound?.(null);
      }
    };

    lookupGenotypeId();
  }, [value, experimentId]); // onGenotypeIdFound omitted from deps - it's a callback, not data

  // Validate on value change
  useEffect(() => {
    validateBarcode(value);
  }, [value, validateBarcode]);

  // Handle input change with sanitization
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitizePlantBarcode(e.target.value);
    onChange(sanitized);
    setShowDropdown(true);
    setHighlightedIndex(-1);
  };

  // Handle selecting a suggestion
  const handleSelectSuggestion = (barcode: string) => {
    onChange(barcode);
    setShowDropdown(false);
    setHighlightedIndex(-1);
    inputRef.current?.focus();
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || filteredBarcodes.length === 0) {
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < filteredBarcodes.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (
          highlightedIndex >= 0 &&
          highlightedIndex < filteredBarcodes.length
        ) {
          handleSelectSuggestion(filteredBarcodes[highlightedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowDropdown(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  // Handle focus
  const handleFocus = () => {
    if (value.trim() && filteredBarcodes.length > 0) {
      setShowDropdown(true);
    }
  };

  // Handle blur - close dropdown after a short delay (to allow click on suggestion)
  const handleBlur = () => {
    if (blurTimeoutRef.current !== null) {
      clearTimeout(blurTimeoutRef.current);
    }
    blurTimeoutRef.current = window.setTimeout(() => {
      setShowDropdown(false);
      setHighlightedIndex(-1);
      blurTimeoutRef.current = null;
    }, 200);
  };

  // Cleanup blur timeout on unmount
  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current !== null) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
    };
  }, []);

  // Determine border color based on validation
  const borderClass = validationError ? 'border-red-500' : 'border-gray-300';

  const inputClassName = `w-full px-3 py-2 border ${borderClass} rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed ${className}`;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        disabled={disabled}
        placeholder={placeholder}
        className={inputClassName}
        autoComplete="off"
        data-testid="plant-barcode-input"
      />

      {/* Loading indicator */}
      {isLoading && (
        <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
          <div className="animate-spin h-4 w-4 border-2 border-blue-500 rounded-full border-t-transparent"></div>
        </div>
      )}

      {/* Autocomplete dropdown */}
      {showDropdown && filteredBarcodes.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto"
          data-testid="plant-barcode-dropdown"
        >
          {filteredBarcodes.map((barcode, index) => (
            <div
              key={barcode}
              className={`px-3 py-2 cursor-pointer ${
                index === highlightedIndex
                  ? 'bg-blue-100 text-blue-900'
                  : 'hover:bg-gray-100'
              }`}
              onClick={() => handleSelectSuggestion(barcode)}
              data-testid={`plant-barcode-option-${index}`}
            >
              {barcode}
            </div>
          ))}
        </div>
      )}

      {/* Validation error */}
      {validationError && (
        <p
          className="text-red-600 text-sm mt-1"
          data-testid="plant-barcode-error"
        >
          {validationError}
        </p>
      )}
    </div>
  );
}
