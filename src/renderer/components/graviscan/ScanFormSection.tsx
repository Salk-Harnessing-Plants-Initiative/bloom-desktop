/**
 * Plate assignment grid — editable in both auto-fill and manual modes
 * (design.md Decision 3, point 1): auto-fill pre-populates, it never
 * locks a field read-only. Renders one section per scanner.
 */
import type { PlateAssignment } from '../../../types/graviscan';
import { getPlateLabel } from '../../../types/graviscan';

export interface ScanFormSectionProps {
  scannerIds: string[];
  scannerLabels: Record<string, string>;
  assignmentsByScanner: Record<string, PlateAssignment[]>;
  isGraviMetadata: boolean;
  waveMissingMetadata: boolean;
  waveLinkedButEmpty: boolean;
  loadError: string | null;
  saveError: string | null;
  updateField: (
    scannerId: string,
    plateIndex: string,
    field: 'plantBarcode' | 'transplantDate' | 'customNote',
    value: string | null
  ) => void;
  toggleSelected: (scannerId: string, plateIndex: string) => void;
}

export function ScanFormSection({
  scannerIds,
  scannerLabels,
  assignmentsByScanner,
  isGraviMetadata,
  waveMissingMetadata,
  waveLinkedButEmpty,
  loadError,
  saveError,
  updateField,
  toggleSelected,
}: ScanFormSectionProps) {
  return (
    <div className="space-y-4">
      {loadError && (
        <div
          data-testid="plate-load-error"
          className="bg-red-50 border border-red-500 text-red-800 rounded p-2 text-sm"
        >
          {loadError}
        </div>
      )}
      {saveError && (
        <div
          data-testid="plate-save-error"
          className="bg-red-50 border border-red-500 text-red-800 rounded p-2 text-sm"
        >
          Failed to save: {saveError}
        </div>
      )}
      {waveMissingMetadata && (
        <div className="bg-gray-50 border border-gray-300 text-gray-700 rounded p-2 text-sm">
          No metadata linked for this wave — enter plate info manually.
        </div>
      )}
      {waveLinkedButEmpty && (
        <div className="bg-amber-50 border border-amber-300 text-amber-800 rounded p-2 text-sm">
          This wave&apos;s linked accession has no plates — enter plate info
          manually.
        </div>
      )}
      {isGraviMetadata && !waveLinkedButEmpty && (
        <div className="text-sm text-gray-500">
          Auto-filled from linked metadata.
        </div>
      )}

      {scannerIds.map((scannerId) => (
        <div key={scannerId} data-testid={`scan-form-scanner-${scannerId}`}>
          <div className="font-semibold">
            {scannerLabels[scannerId] ?? scannerId}
          </div>
          <div className="space-y-2">
            {(assignmentsByScanner[scannerId] || []).map((plate) => {
              const inputId = `${scannerId}-${plate.plateIndex}-barcode`;
              return (
                <div key={plate.plateIndex} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={plate.selected}
                    onChange={() => toggleSelected(scannerId, plate.plateIndex)}
                    aria-label={`${getPlateLabel(plate.plateIndex)} selected`}
                  />
                  <span>{getPlateLabel(plate.plateIndex)}</span>
                  <label htmlFor={inputId} className="sr-only">
                    Plant Barcode
                  </label>
                  <input
                    id={inputId}
                    type="text"
                    value={plate.plantBarcode ?? ''}
                    onChange={(e) =>
                      updateField(
                        scannerId,
                        plate.plateIndex,
                        'plantBarcode',
                        e.target.value || null
                      )
                    }
                  />
                  <input
                    type="date"
                    aria-label="Transplant Date"
                    value={plate.transplantDate ?? ''}
                    onChange={(e) =>
                      updateField(
                        scannerId,
                        plate.plateIndex,
                        'transplantDate',
                        e.target.value || null
                      )
                    }
                  />
                  <input
                    type="text"
                    aria-label="Custom Note"
                    value={plate.customNote ?? ''}
                    onChange={(e) =>
                      updateField(
                        scannerId,
                        plate.plateIndex,
                        'customNote',
                        e.target.value || null
                      )
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
