/**
 * MetadataForm Component
 *
 * Form for capturing scan metadata (phenotyper, experiment, plant ID, etc.)
 * Uses ExperimentChooser and PhenotyperChooser dropdowns instead of text inputs.
 */

import { ExperimentChooser } from '../renderer/components/ExperimentChooser';
import { PhenotyperChooser } from '../renderer/components/PhenotyperChooser';

export interface ScanMetadata {
  phenotyper: string;
  experimentId: string;
  waveNumber: number;
  plantAgeDays: number;
  plantQrCode: string;
  accessionId: string;
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
}

export function MetadataForm({
  values,
  onChange,
  disabled = false,
  errors = {},
}: MetadataFormProps) {
  const handleFieldChange = (
    field: keyof ScanMetadata,
    value: string | number
  ) => {
    onChange({
      ...values,
      [field]: value,
    });
  };

  const inputClassName =
    'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed';
  const labelClassName = 'block text-sm font-medium text-gray-700 mb-1';
  const errorClassName = 'text-red-600 text-sm mt-1';

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">
        Scan Metadata
      </h2>

      {/* Phenotyper - now using PhenotyperChooser */}
      <div>
        <label className={labelClassName}>
          Phenotyper <span className="text-red-500">*</span>
        </label>
        <PhenotyperChooser
          value={values.phenotyper || null}
          onPhenotyperChange={(id) => handleFieldChange('phenotyper', id || '')}
          disabled={disabled}
        />
        {errors.phenotyper && (
          <p className={errorClassName}>{errors.phenotyper}</p>
        )}
      </div>

      {/* Experiment - now using ExperimentChooser */}
      <div>
        <label className={labelClassName}>
          Experiment <span className="text-red-500">*</span>
        </label>
        <ExperimentChooser
          value={values.experimentId || null}
          onExperimentChange={(id) => handleFieldChange('experimentId', id || '')}
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

      {/* Plant QR Code / ID */}
      <div>
        <label htmlFor="plantQrCode" className={labelClassName}>
          Plant ID / QR Code <span className="text-red-500">*</span>
        </label>
        <input
          id="plantQrCode"
          type="text"
          value={values.plantQrCode}
          onChange={(e) => handleFieldChange('plantQrCode', e.target.value)}
          disabled={disabled}
          className={inputClassName}
          placeholder="e.g., Plant-001"
        />
        {errors.plantQrCode && (
          <p className={errorClassName}>{errors.plantQrCode}</p>
        )}
      </div>

      {/* Accession ID */}
      <div>
        <label htmlFor="accessionId" className={labelClassName}>
          Accession ID <span className="text-red-500">*</span>
        </label>
        <input
          id="accessionId"
          type="text"
          value={values.accessionId}
          onChange={(e) => handleFieldChange('accessionId', e.target.value)}
          disabled={disabled}
          className={inputClassName}
          placeholder="e.g., ACC-12345"
        />
        {errors.accessionId && (
          <p className={errorClassName}>{errors.accessionId}</p>
        )}
        <p className="text-xs text-gray-500 mt-1">
          Accession identifier for this plant
        </p>
      </div>
    </div>
  );
}
