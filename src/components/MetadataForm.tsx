/**
 * MetadataForm Component
 *
 * Form for capturing scan metadata (phenotyper, experiment, plant ID, etc.)
 * Uses ExperimentChooser and PhenotyperChooser dropdowns instead of text inputs.
 * Integrates PlantBarcodeInput for barcode validation and autocomplete.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ExperimentChooser } from '../renderer/components/ExperimentChooser';
import { PhenotyperChooser } from '../renderer/components/PhenotyperChooser';
import { PlantBarcodeInput } from './PlantBarcodeInput';

export interface ScanMetadata {
  phenotyper: string;
  experimentId: string;
  waveNumber: number;
  plantAgeDays: number;
  plantQrCode: string;
  accessionId: string;
  genotypeId: string;
}

export interface MetadataFormProps {
  /** Current metadata values */
  values: ScanMetadata;
  /** Callback when metadata changes */
  onChange: (metadata: ScanMetadata) => void;
  /** Whether the form is disabled (e.g., during scanning) */
  disabled?: boolean;
  /** Validation errors for each field */
  errors?: Partial<Record<keyof ScanMetadata, string>>;
  /** Callback when barcode validation state changes */
  onBarcodeValidationChange?: (isValid: boolean, error?: string) => void;
}

export function MetadataForm({
  values,
  onChange,
  disabled = false,
  errors = {},
  onBarcodeValidationChange,
}: MetadataFormProps) {
  // State for experiment's accession ID (fetched when experiment changes)
  const [experimentAccessionId, setExperimentAccessionId] = useState<
    string | null
  >(null);

  // Ref to track latest values without causing re-renders
  // This prevents infinite loops in callbacks that need current values
  const valuesRef = useRef(values);
  valuesRef.current = values;

  // Fetch experiment's accession when experiment changes
  useEffect(() => {
    const fetchExperimentAccession = async () => {
      if (!values.experimentId) {
        setExperimentAccessionId(null);
        return;
      }

      try {
        const result = await window.electron.database.experiments.get(
          values.experimentId
        );
        if (result.success && result.data) {
          // ExperimentWithRelations includes accession
          const experiment = result.data as {
            accession?: { id: string } | null;
          };
          setExperimentAccessionId(experiment.accession?.id || null);
        } else {
          setExperimentAccessionId(null);
        }
      } catch (error) {
        console.error('Failed to fetch experiment:', error);
        setExperimentAccessionId(null);
      }
    };

    fetchExperimentAccession();
  }, [values.experimentId]);

  const handleFieldChange = useCallback(
    (field: keyof ScanMetadata, value: string | number) => {
      onChange({
        ...values,
        [field]: value,
      });
    },
    [values, onChange]
  );

  // Handle experiment change - reset barcode-related fields
  const handleExperimentChange = useCallback(
    (experimentId: string | null) => {
      onChange({
        ...values,
        experimentId: experimentId || '',
        // Reset barcode-related fields when experiment changes
        plantQrCode: '',
        genotypeId: '',
      });
    },
    [values, onChange]
  );

  // Handle genotype ID found from barcode lookup
  // Uses valuesRef to avoid infinite loop (values in deps would cause re-render cycle)
  const handleGenotypeIdFound = useCallback(
    (genotypeId: string | null) => {
      onChange({
        ...valuesRef.current,
        genotypeId: genotypeId || '',
      });
    },
    [onChange]
  );

  // Handle barcode change
  const handleBarcodeChange = useCallback(
    (barcode: string) => {
      onChange({
        ...values,
        plantQrCode: barcode,
      });
    },
    [values, onChange]
  );

  const inputClassName =
    'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed';
  const labelClassName = 'block text-sm font-medium text-gray-700 mb-1';
  const errorClassName = 'text-red-600 text-sm mt-1';

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">
        Scan Metadata
      </h2>

      {/* Phenotyper - using PhenotyperChooser */}
      <div>
        <label htmlFor="phenotyper-chooser" className={labelClassName}>
          Phenotyper <span className="text-red-500">*</span>
        </label>
        <PhenotyperChooser
          id="phenotyper-chooser"
          value={values.phenotyper || null}
          onPhenotyperChange={(phenotyperId) =>
            handleFieldChange('phenotyper', phenotyperId || '')
          }
          disabled={disabled}
        />
        {errors.phenotyper && (
          <p className={errorClassName}>{errors.phenotyper}</p>
        )}
      </div>

      {/* Experiment - using ExperimentChooser */}
      <div>
        <label htmlFor="experiment-chooser" className={labelClassName}>
          Experiment <span className="text-red-500">*</span>
        </label>
        <ExperimentChooser
          id="experiment-chooser"
          value={values.experimentId || null}
          onExperimentChange={handleExperimentChange}
          disabled={disabled}
        />
        {errors.experimentId && (
          <p className={errorClassName}>{errors.experimentId}</p>
        )}
      </div>

      {/* Wave Number */}
      <div>
        <label htmlFor="waveNumber" className={labelClassName}>
          Wave Number <span className="text-red-500">*</span>
        </label>
        <input
          id="waveNumber"
          type="number"
          min="1"
          value={values.waveNumber || ''}
          onChange={(e) =>
            handleFieldChange('waveNumber', parseInt(e.target.value, 10) || 0)
          }
          disabled={disabled}
          className={inputClassName}
          placeholder="1"
        />
        {errors.waveNumber && (
          <p className={errorClassName}>{errors.waveNumber}</p>
        )}
      </div>

      {/* Plant Age (Days) */}
      <div>
        <label htmlFor="plantAgeDays" className={labelClassName}>
          Plant Age (Days) <span className="text-red-500">*</span>
        </label>
        <input
          id="plantAgeDays"
          type="number"
          min="0"
          value={values.plantAgeDays || ''}
          onChange={(e) =>
            handleFieldChange('plantAgeDays', parseInt(e.target.value, 10) || 0)
          }
          disabled={disabled}
          className={inputClassName}
          placeholder="e.g., 14"
        />
        {errors.plantAgeDays && (
          <p className={errorClassName}>{errors.plantAgeDays}</p>
        )}
      </div>

      {/* Plant Barcode / QR Code - using PlantBarcodeInput with validation */}
      <div>
        <label htmlFor="plantQrCode" className={labelClassName}>
          Plant ID / Barcode <span className="text-red-500">*</span>
        </label>
        <PlantBarcodeInput
          id="plantQrCode"
          value={values.plantQrCode}
          onChange={handleBarcodeChange}
          onGenotypeIdFound={handleGenotypeIdFound}
          onValidationChange={onBarcodeValidationChange}
          experimentId={values.experimentId || null}
          accessionId={experimentAccessionId}
          disabled={disabled}
          placeholder="e.g., PLANT_001"
        />
        {errors.plantQrCode && (
          <p className={errorClassName}>{errors.plantQrCode}</p>
        )}
        {experimentAccessionId && (
          <p className="text-xs text-gray-500 mt-1">
            Autocomplete enabled from accession file
          </p>
        )}
      </div>

      {/* Genotype ID - auto-populated from barcode lookup */}
      <div>
        <label htmlFor="genotypeId" className={labelClassName}>
          Genotype ID
        </label>
        <input
          id="genotypeId"
          type="text"
          value={values.genotypeId}
          onChange={(e) => handleFieldChange('genotypeId', e.target.value)}
          disabled={disabled}
          className={`${inputClassName} ${values.genotypeId ? 'bg-green-50' : ''}`}
          placeholder={
            experimentAccessionId
              ? 'Auto-populated from barcode'
              : 'e.g., GT_ABC123'
          }
          readOnly={!!experimentAccessionId && !!values.genotypeId}
        />
        {errors.genotypeId && (
          <p className={errorClassName}>{errors.genotypeId}</p>
        )}
        {experimentAccessionId && values.genotypeId && (
          <p className="text-xs text-green-600 mt-1">
            Auto-populated from accession mapping
          </p>
        )}
      </div>
    </div>
  );
}
