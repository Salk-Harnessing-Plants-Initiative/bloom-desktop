/**
 * Whether Start Scan can be pressed, given each scanner's status (#159).
 *
 * Only scanners with plates selected count. A scanner still connecting
 * (`starting`) or in error blocks the start, with a message naming it. A
 * `disconnected` one does not: its worker hasn't been started yet in this
 * app run, and Start Scan starts it.
 */
import type { ScannerPanelState, PlateAssignment } from '../../types/graviscan';

const FAILED_STATUSES: ReadonlySet<ScannerPanelState['connectionStatus']> =
  new Set(['error', 'dead']);

export function startBlockedReason(
  scanners: Pick<
    ScannerPanelState,
    'scannerId' | 'name' | 'connectionStatus'
  >[],
  assignmentsByScanner: Record<string, PlateAssignment[]>
): string | null {
  for (const scanner of scanners) {
    const hasPlates = (assignmentsByScanner[scanner.scannerId] ?? []).some(
      (a) => a.selected
    );
    if (!hasPlates) continue;
    const name = scanner.name || scanner.scannerId;
    if (scanner.connectionStatus === 'starting') {
      return `${name} is still connecting. Start Scan will be available when it's ready.`;
    }
    if (FAILED_STATUSES.has(scanner.connectionStatus)) {
      return `${name} isn't ready (${scanner.connectionStatus}). Reset USB or re-detect the scanners.`;
    }
  }
  return null;
}
