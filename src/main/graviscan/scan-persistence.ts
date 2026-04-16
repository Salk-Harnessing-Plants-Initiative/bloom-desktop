/**
 * GraviScan Persistence Module
 *
 * Creates GraviScan, GraviImage, and GraviScanSession database records
 * in response to coordinator events and session lifecycle calls.
 *
 * All DB operations are wrapped in try/catch — failures are logged but
 * never abort the scan.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ScanSessionState, ScanSessionJob } from '../../types/graviscan';
import type { ScanCoordinatorLike, SessionFns } from './session-handlers';

// =============================================================================
// Types
// =============================================================================

interface GridCompletePayload {
  cycle: number;
  renamedFiles: Array<{ oldPath: string; newPath: string; scannerId: string }>;
  renameErrors: Record<string, { error: string }>;
  gridIndex: string;
  scanStartedAt: string;
  scanEndedAt: string;
}

// =============================================================================
// Coordinator persistence wiring
// =============================================================================

/**
 * Register listeners on the coordinator to persist scan records on events.
 * Follows the setupCoordinatorEventForwarding pattern in wiring.ts.
 */
export function setupCoordinatorPersistence(
  coordinator: ScanCoordinatorLike,
  db: any,
  sessionFns: SessionFns
): void {
  coordinator.on('grid-complete', async (payload: GridCompletePayload) => {
    const session: ScanSessionState | null = sessionFns.getScanSession();
    if (!session) {
      console.warn(
        '[scan-persistence] grid-complete fired but no active session'
      );
      return;
    }

    for (const renamedFile of payload.renamedFiles) {
      // Skip scanners that had rename errors
      if (payload.renameErrors[renamedFile.scannerId]) {
        continue;
      }

      const jobKey = `${renamedFile.scannerId}:${payload.gridIndex}`;
      const job: ScanSessionJob | undefined = session.jobs[jobKey];
      if (!job) {
        console.warn(`[scan-persistence] No job found for key ${jobKey}`);
        continue;
      }

      try {
        await db.graviScan.create({
          data: {
            experiment_id: session.experimentId,
            phenotyper_id: session.phenotyperId,
            scanner_id: renamedFile.scannerId,
            session_id: session.sessionId,
            cycle_number: payload.cycle,
            wave_number: session.waveNumber,
            plate_barcode: job.plantBarcode,
            transplant_date: job.transplantDate
              ? new Date(job.transplantDate)
              : null,
            custom_note: job.customNote,
            path: renamedFile.newPath,
            scan_started_at: new Date(payload.scanStartedAt),
            scan_ended_at: new Date(payload.scanEndedAt),
            grid_mode: job.gridMode,
            plate_index: payload.gridIndex,
            resolution: session.resolution,
            format: 'tiff',
            images: {
              create: [
                {
                  path: renamedFile.newPath,
                  status: 'pending',
                  box_status: 'pending',
                },
              ],
            },
          },
        });
      } catch (error: any) {
        console.warn(
          `[scan-persistence] Failed to create GraviScan record: ${error.message}`
        );
      }
    }
  });
}

// =============================================================================
// Session record helpers (called from session-handlers.ts)
// =============================================================================

/**
 * Create a GraviScanSession record from session state.
 * Returns the created session ID.
 */
export async function createGraviScanSession(
  db: any,
  session: ScanSessionState
): Promise<string | null> {
  try {
    const record = await db.graviScanSession.create({
      data: {
        experiment_id: session.experimentId,
        phenotyper_id: session.phenotyperId,
        scan_mode: session.isContinuous ? 'interval' : 'once',
        interval_seconds: session.isContinuous
          ? Math.round(session.intervalMs / 1000)
          : null,
        duration_seconds: session.isContinuous
          ? Math.round(session.scanDurationMs / 1000)
          : null,
        total_cycles: session.totalCycles || null,
        started_at: new Date(session.scanStartedAt),
      },
    });
    return record.id;
  } catch (error: any) {
    console.warn(
      `[scan-persistence] Failed to create GraviScanSession: ${error.message}`
    );
    return null;
  }
}

/**
 * Mark a GraviScanSession as completed.
 */
export async function completeGraviScanSession(
  db: any,
  sessionId: string,
  cancelled: boolean
): Promise<void> {
  try {
    await db.graviScanSession.update({
      where: { id: sessionId },
      data: {
        completed_at: new Date(),
        cancelled,
      },
    });
  } catch (error: any) {
    console.warn(
      `[scan-persistence] Failed to complete GraviScanSession: ${error.message}`
    );
  }
}
