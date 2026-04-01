import type {
  DetectedScanner,
  ScannerAssignment,
  PlateAssignment,
  AvailablePlate,
} from '../../../types/graviscan';
import { getPlateLabel, formatPlateIndex } from '../../../types/graviscan';

export interface ListItem {
  id: string;
  name: string;
}

interface ScanFormSectionProps {
  // Experiment & phenotyper
  experiments: ListItem[];
  selectedExperiment: string;
  setSelectedExperiment: (value: string) => void;
  phenotypers: ListItem[];
  selectedPhenotyper: string;
  setSelectedPhenotyper: (value: string) => void;

  // Wave
  waveNumber: number;
  setWaveNumber: React.Dispatch<React.SetStateAction<number>>;
  suggestedWaveNumber: number | null;
  barcodeWaveConflicts: Record<string, string>;
  hasBarcodeConflicts: boolean;

  // Plate assignments
  scannerPlateAssignments: Record<string, PlateAssignment[]>;
  scannerAssignments: ScannerAssignment[];
  detectedScanners: DetectedScanner[];
  assignedScannerIds: string[];
  selectedPlates: string[];
  selectedPlatesWithBarcodes: PlateAssignment[];
  availableBarcodes: string[];
  loadingBarcodes: boolean;
  availablePlates: AvailablePlate[];
  barcodeGenotypes: Record<string, string>;
  isGraviMetadata: boolean;

  // Handlers
  handleTogglePlate: (scannerId: string, plateIndex: string) => void;
  handlePlateBarcode: (
    scannerId: string,
    plateIndex: string,
    barcode: string | null
  ) => void;

  // State
  isScanning: boolean;

  // QR verification results: "scannerId:plateIndex" → { status, detectedPlateId, inconsistentMappings? }
  verificationResults?: Record<
    string,
    {
      status: string;
      detectedPlateId: string | null;
      inconsistentMappings?: Record<string, string[]>;
    }
  >;
}

export function ScanFormSection({
  experiments,
  selectedExperiment,
  setSelectedExperiment,
  phenotypers,
  selectedPhenotyper,
  setSelectedPhenotyper,
  waveNumber,
  setWaveNumber,
  suggestedWaveNumber,
  barcodeWaveConflicts,
  hasBarcodeConflicts,
  scannerPlateAssignments,
  scannerAssignments,
  detectedScanners,
  assignedScannerIds,
  selectedPlates,
  selectedPlatesWithBarcodes,
  availableBarcodes,
  loadingBarcodes,
  availablePlates,
  barcodeGenotypes,
  isGraviMetadata,
  handleTogglePlate,
  handlePlateBarcode,
  isScanning,
  verificationResults = {},
}: ScanFormSectionProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-1 gap-4 mb-6">
      {/* Experiment Selector */}
      <div>
        <label
          htmlFor="experiment"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Experiment
        </label>
        <select
          id="experiment"
          value={selectedExperiment}
          onChange={(e) => setSelectedExperiment(e.target.value)}
          disabled={isScanning}
          className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100"
        >
          <option value="">Select experiment...</option>
          {experiments.map((exp) => (
            <option key={exp.id} value={exp.id}>
              {exp.name}
            </option>
          ))}
        </select>
      </div>

      {/* Phenotyper Selector */}
      <div>
        <label
          htmlFor="phenotyper"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Phenotyper
        </label>
        <select
          id="phenotyper"
          value={selectedPhenotyper}
          onChange={(e) => setSelectedPhenotyper(e.target.value)}
          disabled={isScanning}
          className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100"
        >
          <option value="">Select phenotyper...</option>
          {phenotypers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Wave Number Spinner */}
      <div>
        <label
          htmlFor="waveNumber"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Wave Number
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWaveNumber((prev) => Math.max(0, prev - 1))}
            disabled={isScanning || waveNumber <= 0}
            className="px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
          >
            -
          </button>
          <input
            id="waveNumber"
            type="number"
            min={0}
            value={waveNumber}
            onChange={(e) =>
              setWaveNumber(Math.max(0, parseInt(e.target.value) || 0))
            }
            disabled={isScanning}
            className="w-20 text-center px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100"
          />
          <button
            type="button"
            onClick={() => setWaveNumber((prev) => prev + 1)}
            disabled={isScanning}
            className="px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
          >
            +
          </button>
          {suggestedWaveNumber !== null &&
            waveNumber !== suggestedWaveNumber && (
              <button
                type="button"
                onClick={() => setWaveNumber(suggestedWaveNumber)}
                className="text-xs text-blue-600 hover:text-blue-800 underline"
              >
                Suggested: {suggestedWaveNumber}
              </button>
            )}
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Experimental phase (0 = baseline)
        </p>
        {hasBarcodeConflicts && (
          <div className="mt-2 space-y-1">
            {Object.entries(barcodeWaveConflicts).map(
              ([plateIndex, message]) => (
                <p key={plateIndex} className="text-xs text-amber-600">
                  Plate {formatPlateIndex(plateIndex)}: {message}
                </p>
              )
            )}
          </div>
        )}
      </div>

      {/* Plate Selection — Per Scanner */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">
            Plates to Scan ({selectedPlates.length} selected)
          </label>
          {availableBarcodes.length === 0 &&
            selectedExperiment &&
            !loadingBarcodes && (
              <span className="text-xs text-amber-600">
                {isGraviMetadata
                  ? 'No plates found for this experiment'
                  : 'No plant barcodes found for this experiment'}
              </span>
            )}
          {loadingBarcodes && (
            <span className="text-xs text-gray-500">
              {isGraviMetadata ? 'Loading plates...' : 'Loading barcodes...'}
            </span>
          )}
        </div>

        {/* Show message if no scanners are assigned */}
        {assignedScannerIds.length === 0 && (
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-center">
            <p className="text-sm text-gray-500">
              No scanners assigned. Configure scanners above to assign plates.
            </p>
          </div>
        )}

        {/* Plate assignments grouped by scanner */}
        <div className="space-y-4">
          {assignedScannerIds.map((scannerId) => {
            const scanner = detectedScanners.find(
              (s) => s.scanner_id === scannerId
            );
            const scannerAssignment = scannerAssignments.find(
              (a) => a.scannerId === scannerId
            );
            const plateAssignments = scannerPlateAssignments[scannerId] || [];

            return (
              <div
                key={scannerId}
                className="border border-gray-200 rounded-lg overflow-hidden"
              >
                {/* Scanner Header */}
                <div className="bg-gray-100 px-3 py-2 border-b border-gray-200 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">
                    {scannerAssignment?.slot || 'Scanner'}:{' '}
                    {scanner?.name || scannerId}
                  </span>
                  <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded">
                    {scannerAssignment?.gridMode === '4grid'
                      ? '4-grid'
                      : '2-grid'}
                  </span>
                </div>

                {/* Plate Assignments for this Scanner */}
                <div className="p-2 space-y-2">
                  {plateAssignments.map((assignment) => (
                    <div
                      key={`${scannerId}-${assignment.plateIndex}`}
                      className={`p-2 rounded-lg border transition-colors space-y-1 ${
                        assignment.selected
                          ? 'bg-blue-50 border-blue-200'
                          : 'bg-gray-50 border-gray-200'
                      } ${isScanning ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          id={`plate-${scannerId}-${assignment.plateIndex}`}
                          checked={assignment.selected}
                          onChange={() =>
                            handleTogglePlate(scannerId, assignment.plateIndex)
                          }
                          disabled={isScanning}
                          className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />

                        {/* Plate Label */}
                        <label
                          htmlFor={`plate-${scannerId}-${assignment.plateIndex}`}
                          className="text-sm font-medium text-gray-700 w-12 cursor-pointer"
                        >
                          {getPlateLabel(assignment.plateIndex)}
                        </label>

                        {isGraviMetadata ? (
                          /* Auto-assigned plate display for GraviScan metadata */
                          assignment.plantBarcode ? (
                            <div className="flex-1 flex items-center gap-2 min-w-0">
                              <span className="text-sm font-medium text-gray-900 whitespace-nowrap">
                                {assignment.plantBarcode}
                              </span>
                              {(() => {
                                const plateInfo = availablePlates.find(
                                  (p) => p.plate_id === assignment.plantBarcode
                                );
                                if (
                                  !plateInfo ||
                                  plateInfo.plantQrCodes.length === 0
                                )
                                  return null;
                                return (
                                  <div className="flex-1 overflow-x-auto whitespace-nowrap">
                                    <span className="text-xs text-gray-500">
                                      ({plateInfo.plantQrCodes.join(', ')})
                                    </span>
                                  </div>
                                );
                              })()}
                            </div>
                          ) : (
                            <span className="flex-1 text-sm text-gray-400 italic">
                              Empty
                            </span>
                          )
                        ) : (
                          /* Plant Barcode Dropdown for CylScan metadata */
                          <select
                            value={assignment.plantBarcode || ''}
                            onChange={(e) =>
                              handlePlateBarcode(
                                scannerId,
                                assignment.plateIndex,
                                e.target.value || null
                              )
                            }
                            disabled={isScanning || !assignment.selected}
                            className={`flex-1 px-3 py-1.5 text-sm border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                              !assignment.selected
                                ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                                : 'bg-white border-gray-300'
                            }`}
                          >
                            <option value="">Select plant barcode...</option>
                            {availableBarcodes.map((barcode) => (
                              <option key={barcode} value={barcode}>
                                {barcode}
                              </option>
                            ))}
                          </select>
                        )}

                        {/* Plate summary for GraviScan */}
                        {/* Genotype display for CylScan */}
                        {assignment.selected &&
                          assignment.plantBarcode &&
                          !isGraviMetadata && (
                            <span className="text-xs text-gray-600 min-w-[80px]">
                              {barcodeGenotypes[assignment.plantBarcode] || '-'}
                            </span>
                          )}

                        {/* QR Verification status label */}
                        {(() => {
                          const key = `${scannerId}:${assignment.plateIndex}`;
                          const vr = verificationResults[key];
                          if (!vr) {
                            // No verification yet — show assigned checkmark
                            return assignment.selected &&
                              assignment.plantBarcode ? (
                              <svg
                                className="h-5 w-5 text-green-500 flex-shrink-0"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            ) : null;
                          }
                          if (vr.status === 'verified') {
                            return (
                              <span className="text-xs font-medium text-green-600 whitespace-nowrap">
                                QR Verified
                              </span>
                            );
                          }
                          if (vr.status === 'swapped') {
                            return (
                              <span className="text-xs font-medium text-amber-600 whitespace-nowrap">
                                QR Incorrect
                              </span>
                            );
                          }
                          if (vr.status === 'needs_review') {
                            return (
                              <span className="text-xs font-medium text-amber-600 whitespace-nowrap">
                                Needs Review
                              </span>
                            );
                          }
                          if (vr.status === 'unreadable') {
                            return (
                              <span className="text-xs font-medium text-red-600 whitespace-nowrap">
                                QR Unreadable
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary */}
        {selectedPlates.length > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            {selectedPlatesWithBarcodes.length} of {selectedPlates.length}{' '}
            selected plate(s) have {isGraviMetadata ? 'plates' : 'barcodes'}{' '}
            assigned
          </p>
        )}
      </div>
    </div>
  );
}
