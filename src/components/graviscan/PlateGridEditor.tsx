/**
 * PlateGridEditor component
 *
 * Renders a grid of plate assignment cards for a single scanner.
 * Each card shows plate label, barcode input, transplant date,
 * custom note, and a select checkbox.
 */

import type { PlateAssignment } from '../../types/graviscan';
import { getPlateLabel } from '../../types/graviscan';

interface PlateGridEditorProps {
  assignments: PlateAssignment[];
  onToggle: (plateIndex: string) => void;
  onBarcodeChange: (plateIndex: string, barcode: string | null) => void;
  onTransplantDateChange?: (plateIndex: string, date: string | null) => void;
  onNoteChange?: (plateIndex: string, note: string | null) => void;
  disabled?: boolean;
}

export function PlateGridEditor({
  assignments,
  onToggle,
  onBarcodeChange,
  onTransplantDateChange,
  onNoteChange,
  disabled = false,
}: PlateGridEditorProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {assignments.map((assignment) => (
        <div
          key={assignment.plateIndex}
          className={`border rounded-lg p-4 ${
            assignment.selected
              ? 'border-blue-300 bg-blue-50'
              : 'border-gray-200 bg-gray-50 opacity-60'
          }`}
        >
          {/* Header row: label + checkbox */}
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold text-gray-900 text-sm">
              {getPlateLabel(assignment.plateIndex)}
            </span>
            <label className="flex items-center gap-1 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={assignment.selected}
                onChange={() => onToggle(assignment.plateIndex)}
                disabled={disabled}
                className="w-4 h-4 rounded border-gray-300"
              />
              Scan
            </label>
          </div>

          {/* Barcode input */}
          <div className="mb-2">
            <label className="block text-xs font-medium text-gray-600 mb-0.5">
              Barcode
            </label>
            <input
              type="text"
              value={assignment.plantBarcode || ''}
              onChange={(e) =>
                onBarcodeChange(assignment.plateIndex, e.target.value || null)
              }
              disabled={disabled || !assignment.selected}
              placeholder="Plate barcode"
              className="w-full p-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
            />
          </div>

          {/* Transplant date input */}
          <div className="mb-2">
            <label className="block text-xs font-medium text-gray-600 mb-0.5">
              Transplant Date
            </label>
            <input
              type="date"
              value={assignment.transplantDate || ''}
              onChange={(e) =>
                onTransplantDateChange?.(
                  assignment.plateIndex,
                  e.target.value || null
                )
              }
              disabled={disabled || !assignment.selected}
              className="w-full p-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
            />
          </div>

          {/* Custom note input */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-0.5">
              Note
            </label>
            <input
              type="text"
              value={assignment.customNote || ''}
              onChange={(e) =>
                onNoteChange?.(assignment.plateIndex, e.target.value || null)
              }
              disabled={disabled || !assignment.selected}
              placeholder="Optional note"
              className="w-full p-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
