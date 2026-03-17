/**
 * ScanPreview Component
 *
 * Displays a visual grid preview of scanner plates with per-plate status:
 * - Always shows the grid layout (2-grid or 4-grid) matching scanner config
 * - Each plate cell shows: empty placeholder, scanning spinner, or scanned image
 * - Horizontal scrollable container for multiple scanners
 * - Updates in real-time as individual plates are scanned
 */

import type { ScannerAssignment, PlateAssignment, GridMode } from '../../types/graviscan';
import { formatPlateIndex } from '../../types/graviscan';

/** Per-plate status for the preview */
type PlateStatus = 'idle' | 'scanning' | 'complete' | 'error';

interface ScannerPreviewData {
  assignment: ScannerAssignment;
  plateAssignments: PlateAssignment[];
  testResult?: { success: boolean; error?: string };
  /** Map of plateIndex → base64 data URI for completed scans */
  plateImages: Record<string, string>;
  /** The plate index currently being scanned (if any) */
  scanningPlateIndex?: string;
  /** Overall scanner scanning state */
  isScanning?: boolean;
  /** Overall progress 0-100 */
  scanProgress?: number;
}

interface ScanPreviewProps {
  scanners: ScannerPreviewData[];
  onScannerClick?: (scannerId: string) => void;
  onImageClick?: (imageUri: string, plateIndex: string) => void;
}

/**
 * Single plate cell within the scanner grid.
 * Shows the scanned image, a scanning indicator, or an empty placeholder.
 */
function PlateCell({
  plate,
  gridMode,
  status,
  imageUri,
  onImageClick,
}: {
  plate: PlateAssignment;
  gridMode: GridMode;
  status: PlateStatus;
  imageUri?: string;
  onImageClick?: (imageUri: string, plateIndex: string) => void;
}) {
  const is4Grid = gridMode === '4grid';

  // Plate has a scanned image
  if (status === 'complete' && imageUri) {
    return (
      <div
        className={`relative rounded-lg overflow-hidden border-2 border-green-400 bg-gray-900 ${
          is4Grid ? 'aspect-[3/4]' : 'aspect-[3/4]'
        }`}
        title={`Plate ${formatPlateIndex(plate.plateIndex)}${plate.plantBarcode ? ` — ${plate.plantBarcode}` : ''} (scanned)`}
      >
        <img
          src={imageUri}
          alt={`Scan plate ${formatPlateIndex(plate.plateIndex)}`}
          className={`w-full h-full object-cover ${onImageClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
          onClick={(e) => {
            if (onImageClick && imageUri) {
              e.stopPropagation();
              onImageClick(imageUri, plate.plateIndex);
            }
          }}
        />
        {/* Overlay with plate info */}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-bold text-white">{formatPlateIndex(plate.plateIndex)}</span>
            <svg className="h-3.5 w-3.5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
          {plate.plantBarcode && (
            <span className="text-[10px] text-gray-300 truncate block">{plate.plantBarcode}</span>
          )}
        </div>
      </div>
    );
  }

  // Plate is currently being scanned
  if (status === 'scanning') {
    return (
      <div
        className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-blue-400 bg-blue-50 ${
          is4Grid ? 'aspect-[3/4]' : 'aspect-[3/4]'
        }`}
        title={`Plate ${formatPlateIndex(plate.plateIndex)} — Scanning...`}
      >
        {/* Scanning animation */}
        <div className="relative">
          <svg className="animate-spin h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
        <span className="mt-2 text-xs font-bold text-blue-600">Scanning</span>
        <span className="font-mono text-xs text-blue-400 mt-0.5">{formatPlateIndex(plate.plateIndex)}</span>
        {plate.plantBarcode && (
          <span className="text-[10px] text-blue-400 truncate max-w-full px-1 mt-0.5">{plate.plantBarcode}</span>
        )}
      </div>
    );
  }

  // Plate is idle / waiting — show placeholder
  return (
    <div
      className={`relative flex flex-col items-center justify-center rounded-lg border-2 transition-colors ${
        is4Grid ? 'aspect-[3/4]' : 'aspect-[3/4]'
      } ${
        plate.selected
          ? 'border-blue-300 bg-blue-50/50'
          : 'border-gray-200 bg-gray-50'
      } ${
        status === 'error' ? 'border-red-300 bg-red-50/50' : ''
      }`}
      title={`Plate ${formatPlateIndex(plate.plateIndex)}${plate.plantBarcode ? ` — ${plate.plantBarcode}` : ''}${!plate.selected ? ' (not selected)' : ''}`}
    >
      {/* Scanner bed icon */}
      <svg className={`${is4Grid ? 'h-6 w-6' : 'h-8 w-8'} ${plate.selected ? 'text-blue-300' : 'text-gray-300'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>

      {/* Plate index */}
      <span className={`font-mono font-bold mt-1 ${is4Grid ? 'text-xs' : 'text-sm'} ${plate.selected ? 'text-blue-500' : 'text-gray-400'}`}>
        {formatPlateIndex(plate.plateIndex)}
      </span>

      {/* Plant barcode */}
      {plate.plantBarcode ? (
        <span className={`truncate max-w-full px-1 mt-0.5 ${is4Grid ? 'text-[9px]' : 'text-[10px]'} font-medium text-gray-500`}>
          {plate.plantBarcode.slice(0, 12)}
        </span>
      ) : (
        <span className={`${is4Grid ? 'text-[9px]' : 'text-[10px]'} text-gray-300 italic mt-0.5`}>
          {plate.selected ? 'ready' : 'skip'}
        </span>
      )}

      {/* Selection indicator */}
      {plate.selected && (
        <div className="absolute top-1 right-1">
          <div className={`${is4Grid ? 'h-3 w-3' : 'h-3.5 w-3.5'} rounded-full bg-blue-400`} />
        </div>
      )}

      {/* Error indicator */}
      {status === 'error' && (
        <div className="absolute top-1 left-1">
          <svg className="h-3.5 w-3.5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </div>
      )}
    </div>
  );
}

/**
 * Single scanner preview card — always shows grid layout with per-plate status.
 */
function ScannerPreviewCard({
  scanner,
  onClick,
  onImageClick,
}: {
  scanner: ScannerPreviewData;
  onClick?: () => void;
  onImageClick?: (imageUri: string, plateIndex: string) => void;
}) {
  const gridMode = scanner.assignment.gridMode || '2grid';
  const is4Grid = gridMode === '4grid';
  const hasTestResult = scanner.testResult !== undefined;
  const testSuccess = scanner.testResult?.success ?? false;
  const plates = scanner.plateAssignments;
  const completedCount = Object.keys(scanner.plateImages).length;
  const totalSelected = plates.filter((p) => p.selected).length;

  // Determine per-plate status
  function getPlateStatus(plate: PlateAssignment): PlateStatus {
    if (scanner.scanningPlateIndex === plate.plateIndex) return 'scanning';
    if (scanner.plateImages[plate.plateIndex]) return 'complete';
    return 'idle';
  }

  // Overall scanner status
  let statusColor = 'border-gray-200';
  let statusBg = 'bg-gradient-to-br from-white to-gray-50';
  let statusBadge: React.ReactNode = null;

  if (scanner.isScanning) {
    statusColor = 'border-blue-400';
    statusBg = 'bg-gradient-to-br from-blue-50 to-indigo-50';
    statusBadge = (
      <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
        <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-xs font-bold">
          {scanner.scanProgress !== undefined ? `${scanner.scanProgress}%` : 'Scanning'}
        </span>
      </div>
    );
  } else if (completedCount > 0 && completedCount >= totalSelected) {
    statusColor = 'border-green-400';
    statusBg = 'bg-gradient-to-br from-green-50 to-emerald-50';
    statusBadge = (
      <div className="px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-xs font-bold">
        Complete
      </div>
    );
  } else if (completedCount > 0) {
    statusColor = 'border-amber-300';
    statusBg = 'bg-gradient-to-br from-amber-50 to-yellow-50';
    statusBadge = (
      <div className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
        {completedCount}/{totalSelected}
      </div>
    );
  } else if (hasTestResult) {
    statusColor = testSuccess ? 'border-green-400' : 'border-red-400';
    statusBg = testSuccess
      ? 'bg-gradient-to-br from-green-50 to-emerald-50'
      : 'bg-gradient-to-br from-red-50 to-rose-50';
    statusBadge = (
      <div className={`px-2.5 py-1 rounded-full text-xs font-bold ${
        testSuccess ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      }`}>
        {testSuccess ? 'Ready' : 'Error'}
      </div>
    );
  }

  return (
    <div
      className={`flex-shrink-0 p-4 rounded-2xl border-2 transition-all cursor-pointer hover:shadow-md ${statusColor} ${statusBg}`}
      onClick={onClick}
      style={{ minWidth: is4Grid ? '320px' : '320px', maxWidth: '400px' }}
    >
      {/* Scanner header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2.5">
          <div className={`p-1.5 rounded-lg ${
            scanner.isScanning ? 'bg-blue-200' :
            completedCount > 0 ? 'bg-green-200' :
            hasTestResult ? (testSuccess ? 'bg-green-200' : 'bg-red-200') :
            'bg-gray-200'
          }`}>
            <svg className={`h-5 w-5 ${
              scanner.isScanning ? 'text-blue-700' :
              completedCount > 0 ? 'text-green-700' :
              hasTestResult ? (testSuccess ? 'text-green-700' : 'text-red-700') :
              'text-gray-600'
            }`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          </div>
          <div>
            <span className="text-sm font-bold text-gray-800">{scanner.assignment.slot}</span>
            <div className={`text-[10px] font-semibold mt-0.5 ${
              is4Grid ? 'text-purple-500' : 'text-blue-500'
            }`}>
              {is4Grid ? '4-grid' : '2-grid'} · {totalSelected} plate{totalSelected !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
        {statusBadge}
      </div>

      {/* Plate grid — always visible */}
      <div className={`grid gap-2 ${is4Grid ? 'grid-cols-2' : 'grid-cols-2'}`}>
        {plates.map((plate) => (
          <PlateCell
            key={plate.plateIndex}
            plate={plate}
            gridMode={gridMode}
            status={getPlateStatus(plate)}
            imageUri={scanner.plateImages[plate.plateIndex]}
            onImageClick={onImageClick}
          />
        ))}
      </div>

      {/* Progress bar (during scanning) */}
      {scanner.isScanning && scanner.scanProgress !== undefined && (
        <div className="mt-3">
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${scanner.scanProgress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Main ScanPreview component
 */
export function ScanPreview({ scanners, onScannerClick, onImageClick }: ScanPreviewProps) {
  if (scanners.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 bg-gradient-to-br from-gray-50 to-slate-100 rounded-2xl border-2 border-dashed border-gray-300">
        <div className="p-4 bg-gray-200 rounded-2xl mb-4">
          <svg className="h-16 w-16 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-600 mb-1">No Scanners Configured</h3>
        <p className="text-sm text-gray-400">Detect and assign scanners below to see preview</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">Scanner Preview</h3>
          <p className="text-xs text-gray-500 mt-0.5">Each cell represents a plate position on the scanner bed</p>
        </div>
        <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
          {scanners.length} scanner{scanners.length > 1 ? 's' : ''}
        </span>
      </div>

      {/* Horizontal scrollable container */}
      <div className="overflow-x-auto pb-2 -mx-2 px-2">
        <div className="flex space-x-4 min-w-min">
          {scanners.map((scanner) => (
            <ScannerPreviewCard
              key={scanner.assignment.scannerId || scanner.assignment.slot}
              scanner={scanner}
              onClick={() => scanner.assignment.scannerId && onScannerClick?.(scanner.assignment.scannerId)}
              onImageClick={onImageClick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
