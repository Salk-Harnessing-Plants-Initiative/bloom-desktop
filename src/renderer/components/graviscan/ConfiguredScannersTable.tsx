/**
 * Saved scanners on the Configure Scanner page: name, port, status, a grid
 * mode selector per scanner (#491) and the Remove action. Both actions are
 * disabled while a scan is active.
 */

import type { GridMode, ScannerStatusRow } from '../../../types/graviscan';

interface ConfiguredScannersTableProps {
  scanners: ScannerStatusRow[];
  scanActive: boolean;
  onGridModeChange: (scannerId: string, gridMode: GridMode) => void;
  onRemove: (scannerId: string) => void;
}

export function ConfiguredScannersTable({
  scanners,
  scanActive,
  onGridModeChange,
  onRemove,
}: ConfiguredScannersTableProps) {
  if (scanners.length === 0) {
    return (
      <p className="text-gray-500 text-sm">
        No scanners configured yet. Click Detect Scanners.
      </p>
    );
  }

  return (
    <table className="w-full text-sm">
      <tbody>
        {scanners.map((s) => (
          <tr key={s.scannerId} className="border-t border-gray-100">
            <td className="py-2">{s.displayName}</td>
            <td className="py-2 text-gray-500">{s.usbPort}</td>
            <td className="py-2 capitalize">{s.status}</td>
            <td className="py-2">
              <select
                aria-label={`Grid mode for ${s.displayName}`}
                value={s.gridMode}
                onChange={(e) =>
                  onGridModeChange(s.scannerId, e.target.value as GridMode)
                }
                disabled={scanActive}
                title={
                  scanActive
                    ? 'Grid mode cannot be changed during a scan'
                    : undefined
                }
                className="px-2 py-1 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="2grid">2-grid</option>
                <option value="4grid">4-grid</option>
              </select>
            </td>
            <td className="py-2 text-right">
              <button
                onClick={() => onRemove(s.scannerId)}
                disabled={scanActive}
                className="px-3 py-1 text-red-600 border border-red-300 rounded-md hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Remove
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
