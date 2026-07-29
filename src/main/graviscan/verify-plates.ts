/**
 * GraviScan Post-Scan Plate Position Verification
 *
 * Ported from Ben's monolithic graviscan-handlers.ts (`graviscan:verify-plates`).
 * Verifies plate positions by reading QR codes from scan images.
 * Image-first flow: read QR -> DB lookup plate_id -> compare with assigned.
 *
 * Input: plates with image paths + assigned plate_id (no expected QR codes needed)
 * Process: readQrCodes(image) -> lookup plant_qr in GraviPlateSectionMapping -> get plate_id -> compare
 * Returns: verification results + detected swaps
 *
 * Progress events are delivered via callback injection rather than direct
 * mainWindow.webContents.send() calls, keeping this module decoupled from
 * Electron IPC plumbing (same pattern as image-handlers.ts).
 */

import { PrismaClient } from '@prisma/client';
import { readQrCodes } from '../qr-reader';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VerifyPlateInput = {
  scannerId: string;
  plateIndex: string;
  imagePath: string;
  assignedPlateId: string;
};

export type VerifyStatus =
  | 'verified'
  | 'incorrect'
  | 'unreadable'
  | 'skipped'
  | 'needs_review'
  | 'duplicate_qr';

export type VerifyPlateResult = {
  scannerId: string;
  plateIndex: string;
  assignedPlateId: string;
  detectedPlateId: string | null;
  detectedCodes: string[];
  status: VerifyStatus;
  inconsistentMappings?: Record<string, string[]>;
  duplicateQrCodes?: string[];
};

export type PlateSwap = {
  position1: {
    scannerId: string;
    plateIndex: string;
    assignedPlateId: string;
  };
  position2: {
    scannerId: string;
    plateIndex: string;
    assignedPlateId: string;
  };
};

export type VerifyPlatesResult = {
  success: boolean;
  results: VerifyPlateResult[];
  swaps: PlateSwap[];
  error?: string;
};

export type VerifyProgressEvent =
  | { type: 'verify-started' }
  | { type: 'verify-result'; result: Partial<VerifyPlateResult> }
  | {
      type: 'verify-complete';
      results: VerifyPlateResult[];
      swaps: PlateSwap[];
    };

// ---------------------------------------------------------------------------
// verifyPlates
// ---------------------------------------------------------------------------

/**
 * Verify plate positions by reading QR codes from scan images and comparing
 * against the assigned plate for each scanner/position. Detects "swap" pairs
 * (two positions that each hold the other's assigned plate) and
 * auto-corrects them in the DB. Persists a final `verification_status` onto
 * `GraviScanPlateAssignment` for every plate in the batch.
 *
 * Each DB write is wrapped in its own try/catch so one bad record can't
 * abort the rest of the batch.
 */
export async function verifyPlates(
  db: PrismaClient,
  plates: VerifyPlateInput[],
  experimentId?: string,
  onProgress?: (event: VerifyProgressEvent) => void
): Promise<VerifyPlatesResult> {
  try {
    console.log(`[GraviScan:VERIFY] Verifying ${plates.length} plate(s)...`);

    onProgress?.({ type: 'verify-started' });

    const results: VerifyPlateResult[] = [];

    // Step 1: Read QR codes from ALL plates first
    const plateReadResults: Array<{
      plate: VerifyPlateInput;
      detectedCodes: string[];
    }> = [];

    for (const plate of plates) {
      const detectedCodes = await readQrCodes(plate.imagePath);
      plateReadResults.push({ plate, detectedCodes });
    }

    // Step 2: Detect duplicate QR codes across plates
    const qrToGrids: Record<string, string[]> = {};
    for (const { plate, detectedCodes } of plateReadResults) {
      for (const code of detectedCodes) {
        if (!qrToGrids[code]) qrToGrids[code] = [];
        if (!qrToGrids[code].includes(plate.plateIndex)) {
          qrToGrids[code].push(plate.plateIndex);
        }
      }
    }
    const duplicateQrs = Object.entries(qrToGrids)
      .filter(([, grids]) => grids.length > 1)
      .map(([code]) => code);

    if (duplicateQrs.length > 0) {
      console.warn(
        `[GraviScan:VERIFY] Duplicate QR codes across plates: ${duplicateQrs
          .map((q) => `${q} on grids ${qrToGrids[q].join(',')}`)
          .join('; ')}`
      );
    }

    // Grids that have any duplicate QR code
    const duplicateGrids = new Set<string>();
    for (const code of duplicateQrs) {
      for (const grid of qrToGrids[code]) {
        duplicateGrids.add(grid);
      }
    }

    // Step 3: Verify each plate
    for (const { plate, detectedCodes } of plateReadResults) {
      if (detectedCodes.length === 0) {
        const result: VerifyPlateResult = {
          ...plate,
          detectedPlateId: null,
          detectedCodes: [],
          status: 'unreadable',
        };
        results.push(result);
        onProgress?.({ type: 'verify-result', result });
        continue;
      }

      // Flag plates with duplicate QR codes — skip normal verification
      if (duplicateGrids.has(plate.plateIndex)) {
        const dupsOnThisPlate = duplicateQrs.filter((q) =>
          detectedCodes.includes(q)
        );
        const result: VerifyPlateResult = {
          ...plate,
          detectedPlateId: null,
          detectedCodes,
          status: 'duplicate_qr',
          duplicateQrCodes: dupsOnThisPlate,
        };
        results.push(result);
        onProgress?.({ type: 'verify-result', result });
        continue;
      }

      // DB lookup — find plate_id for ALL detected QR codes
      const plateIdCounts: Record<string, string[]> = {};
      let detectedPlateId: string | null = null;
      let isInconsistent = false;

      try {
        // Scope query to experiment's accession to avoid cross-experiment matches
        const accessionFilter = experimentId
          ? {
              plate: {
                metadata_file: {
                  experiments: { some: { id: experimentId } },
                },
              },
            }
          : {};

        const mappings = await db.graviPlateSectionMapping.findMany({
          where: {
            plant_qr: { in: detectedCodes },
            ...accessionFilter,
          },
          include: {
            plate: true,
          },
        });

        // Group QR codes by their plate_id (case-insensitive to handle metadata inconsistencies)
        for (const mapping of mappings) {
          if (mapping.plate) {
            const pid = mapping.plate.plate_id.toLowerCase();
            if (!plateIdCounts[pid]) plateIdCounts[pid] = [];
            plateIdCounts[pid].push(mapping.plant_qr);
          }
        }

        const plateIds = Object.keys(plateIdCounts);

        if (plateIds.length === 1) {
          // All codes agree — use that plate_id
          detectedPlateId = plateIds[0];
        } else if (plateIds.length > 1) {
          // Codes disagree — find majority
          isInconsistent = true;
          let maxCount = 0;
          for (const [pid, codes] of Object.entries(plateIdCounts)) {
            if (codes.length > maxCount) {
              maxCount = codes.length;
              detectedPlateId = pid;
            }
          }
          console.warn(
            `[GraviScan:VERIFY] Inconsistent QR mappings on ${plate.plateIndex}: ${JSON.stringify(plateIdCounts)}`
          );
        }
      } catch (lookupErr) {
        console.error('[GraviScan:VERIFY] DB lookup failed:', lookupErr);
      }

      // Determine status
      let status: VerifyStatus;
      if (isInconsistent) {
        // QR codes map to different plates — flag for manual review, don't auto-correct
        status = 'needs_review';
      } else if (!detectedPlateId) {
        status = 'unreadable';
      } else if (detectedPlateId === plate.assignedPlateId) {
        status = 'verified';
      } else {
        status = 'incorrect';
      }

      const result: VerifyPlateResult = {
        ...plate,
        detectedPlateId,
        detectedCodes,
        status,
        ...(isInconsistent ? { inconsistentMappings: plateIdCounts } : {}),
      };

      results.push(result);

      onProgress?.({
        type: 'verify-result',
        result: {
          scannerId: plate.scannerId,
          plateIndex: plate.plateIndex,
          assignedPlateId: plate.assignedPlateId,
          detectedPlateId,
          status,
          ...(isInconsistent ? { inconsistentMappings: plateIdCounts } : {}),
        },
      });
    }

    // Detect swaps — two incorrect results where each detected the other's assigned plate_id
    const swaps: PlateSwap[] = [];

    const incorrectResults = results.filter(
      (r) => r.status === 'incorrect' && r.detectedPlateId
    );

    for (const result of incorrectResults) {
      const swapMatch = incorrectResults.find(
        (other) =>
          other !== result &&
          other.detectedPlateId === result.assignedPlateId &&
          result.detectedPlateId === other.assignedPlateId
      );

      if (swapMatch) {
        const alreadyRecorded = swaps.some(
          (s) =>
            (s.position1.assignedPlateId === result.assignedPlateId &&
              s.position2.assignedPlateId === swapMatch.assignedPlateId) ||
            (s.position1.assignedPlateId === swapMatch.assignedPlateId &&
              s.position2.assignedPlateId === result.assignedPlateId)
        );

        if (!alreadyRecorded) {
          swaps.push({
            position1: {
              scannerId: result.scannerId,
              plateIndex: result.plateIndex,
              assignedPlateId: result.assignedPlateId,
            },
            position2: {
              scannerId: swapMatch.scannerId,
              plateIndex: swapMatch.plateIndex,
              assignedPlateId: swapMatch.assignedPlateId,
            },
          });
        }
      }
    }

    // Perform database corrections for detected swaps
    for (const swap of swaps) {
      const { position1, position2 } = swap;
      console.log(
        `[GraviScan:VERIFY] Correcting swap: ${position1.assignedPlateId} <-> ${position2.assignedPlateId}`
      );

      try {
        // 1. Swap plate_barcode in GraviScanPlateAssignment
        await db.graviScanPlateAssignment.updateMany({
          where: {
            scanner_id: position1.scannerId,
            plate_index: position1.plateIndex,
          },
          data: {
            plate_barcode: position2.assignedPlateId,
          },
        });
        await db.graviScanPlateAssignment.updateMany({
          where: {
            scanner_id: position2.scannerId,
            plate_index: position2.plateIndex,
          },
          data: {
            plate_barcode: position1.assignedPlateId,
          },
        });

        // 2. Swap plate_barcode in GraviScan records (scan image records)
        // Find the most recent scan records for each position
        const scan1 = await db.graviScan.findFirst({
          where: {
            scanner_id: position1.scannerId,
            plate_index: position1.plateIndex,
            plate_barcode: position1.assignedPlateId,
            deleted: false,
          },
          orderBy: { capture_date: 'desc' },
        });

        const scan2 = await db.graviScan.findFirst({
          where: {
            scanner_id: position2.scannerId,
            plate_index: position2.plateIndex,
            plate_barcode: position2.assignedPlateId,
            deleted: false,
          },
          orderBy: { capture_date: 'desc' },
        });

        if (scan1) {
          await db.graviScan.update({
            where: { id: scan1.id },
            data: { plate_barcode: position2.assignedPlateId },
          });
        }
        if (scan2) {
          await db.graviScan.update({
            where: { id: scan2.id },
            data: { plate_barcode: position1.assignedPlateId },
          });
        }

        // 3. Log swap for audit trail
        console.log(
          `[GraviScan:VERIFY] Swap corrected: ` +
            `${position1.assignedPlateId} (${position1.scannerId}:${position1.plateIndex}) <-> ` +
            `${position2.assignedPlateId} (${position2.scannerId}:${position2.plateIndex})`
        );
      } catch (swapErr) {
        console.error('[GraviScan:VERIFY] Failed to correct swap:', swapErr);
      }
    }

    // Update verification_status in DB
    for (const result of results) {
      let finalStatus: string = result.status;

      if (
        finalStatus === 'incorrect' &&
        swaps.some(
          (s) =>
            s.position1.assignedPlateId === result.assignedPlateId ||
            s.position2.assignedPlateId === result.assignedPlateId
        )
      ) {
        finalStatus = 'swapped';
      } else if (finalStatus === 'incorrect') {
        finalStatus = 'unreadable';
      }

      try {
        await db.graviScanPlateAssignment.updateMany({
          where: {
            scanner_id: result.scannerId,
            plate_index: result.plateIndex,
          },
          data: {
            verification_status: finalStatus,
          },
        });
      } catch (dbErr) {
        console.error(
          '[GraviScan:VERIFY] Failed to update verification_status:',
          dbErr
        );
      }
    }

    const verified = results.filter((r) => r.status === 'verified').length;
    const unreadable = results.filter((r) => r.status === 'unreadable').length;
    const needsReview = results.filter(
      (r) => r.status === 'needs_review'
    ).length;
    const duplicates = results.filter(
      (r) => r.status === 'duplicate_qr'
    ).length;

    console.log(
      `[GraviScan:VERIFY] Complete: ${verified} verified, ${swaps.length} swaps, ${unreadable} unreadable, ${needsReview} needs_review, ${duplicates} duplicate_qr`
    );

    onProgress?.({ type: 'verify-complete', results, swaps });

    return { success: true, results, swaps };
  } catch (error) {
    console.error('[GraviScan:VERIFY] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Verification failed',
      results: [],
      swaps: [],
    };
  }
}
