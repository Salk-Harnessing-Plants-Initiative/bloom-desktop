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
  /** Wave number as string to support validation of decimals */
  waveNumber: string;
  /** Plant age in days as string to support validation of decimals */
  plantAgeDays: string;
  plantQrCode: string;
  accessionName: string;
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
        accessionName: '',
      });
    },
    [values, onChange]
  );

  // Handle accession name found from barcode lookup
  // Uses valuesRef to avoid infinite loop (values in deps would cause re-render cycle)
  const handleAccessionNameFound = useCallback(
    (accessionName: string | null) => {
      onChange({
        ...valuesRef.current,
        accessionName: accessionName || '',
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
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={values.waveNumber}
          onChange={(e) => handleFieldChange('waveNumber', e.target.value)}
          disabled={disabled}
          className={inputClassName}
          placeholder="e.g., 1"
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
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={values.plantAgeDays}
          onChange={(e) => handleFieldChange('plantAgeDays', e.target.value)}
          disabled={disabled}
          className={inputClassName}
          placeholder="e.g., 14"
        />
        {errors.plantAgeDays && (
          <p className={errorClassName}>{errors.plantAgeDays}</p>
        )}
      </div>

      {/* Accession Requirement Warning */}
      {values.experimentId && !experimentAccessionId && (
        <div
          className="bg-red-50 border-2 border-red-400 rounded-lg p-3"
          data-testid="accession-required-warning"
        >
          <div className="flex items-start">
            <svg
              className="h-5 w-5 text-red-600 mr-2 mt-0.5 flex-shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="font-medium text-red-800">
                Accession file required
              </p>
              <p className="text-sm text-red-700 mt-1">
                Link an accession file to this experiment to enable scanning. Go
                to{' '}
                <a href="#/scientists" className="underline font-medium">
                  Scientists & Experiments
                </a>{' '}
                to manage experiments.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Plant Barcode / QR Code - using PlantBarcodeInput with validation */}
      <div>
        <label htmlFor="plantQrCode" className={labelClassName}>
          Plant ID / Barcode <span className="text-red-500">*</span>
        </label>
        <PlantBarcodeInput
          id="plantQrCode"
          value={values.plantQrCode}
          onChange={handleBarcodeChange}
          onAccessionNameFound={handleAccessionNameFound}
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

      {/* Accession - auto-populated from barcode lookup */}
      <div>
        <label htmlFor="accessionName" className={labelClassName}>
          Accession
        </label>
        <input
          id="accessionName"
          type="text"
          value={values.accessionName}
          onChange={(e) => handleFieldChange('accessionName', e.target.value)}
          disabled={disabled}
          className={`${inputClassName} ${values.accessionName ? 'bg-green-50' : ''}`}
          placeholder={
            experimentAccessionId
              ? 'Auto-populated from barcode'
              : 'e.g., GT_ABC123'
          }
          readOnly={!!experimentAccessionId && !!values.accessionName}
        />
        {errors.accessionName && (
          <p className={errorClassName}>{errors.accessionName}</p>
        )}
        {experimentAccessionId && values.accessionName && (
          <p className="text-xs text-green-600 mt-1">
            Auto-populated from accession mapping
          </p>
        )}
      </div>
    </div>
  );
}
