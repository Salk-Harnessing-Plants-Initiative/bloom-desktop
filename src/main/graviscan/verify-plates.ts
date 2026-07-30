/**
 * GraviScan Post-Scan Plate Position Verification
 *
 * Ported from Ben's monolithic graviscan-handlers.ts (`graviscan:verify-plates`).
 * Verifies plate positions by reading QR codes from scan images.
 * Image-first flow: read QR -> DB lookup plate_id -> compare with assigned.
 *
 * Input: plates with image paths + assigned plate_id (no expected QR codes needed)
 * Process: readQrCodesBatch(images) -> lookup plant_qr in GraviPlateSectionMapping -> get plate_id -> compare
 * Returns: verification results + detected swaps
 *
 * Progress events are delivered via callback injection rather than direct
 * mainWindow.webContents.send() calls, keeping this module decoupled from
 * Electron IPC plumbing (same pattern as image-handlers.ts). For the same
 * reason the scan output directory used for path validation is passed in as
 * a parameter rather than read from `electron.app` here: this module depends
 * only on `db`, a QR-reading function, and plain fs/path utilities.
 */

import { PrismaClient } from '@prisma/client';
import { readQrCodesBatch } from '../qr-reader';
import { resolveContainedPath } from './path-containment';

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
  // Half of a reciprocal pair that was detected and auto-corrected. Set on
  // the result as well as persisted, so the returned payload and the DB row
  // never disagree about the same plate.
  | 'swapped'
  | 'unreadable'
  | 'needs_review'
  | 'duplicate_qr'
  // The image decoded fine but the plate-id lookup itself errored (a locked
  // or unavailable database). Distinct from `unreadable` on purpose: the two
  // call for completely different operator responses (retry vs re-image).
  | 'lookup_failed';

export type VerifyPlateResult = {
  scannerId: string;
  plateIndex: string;
  assignedPlateId: string;
  /**
   * The submitted image this outcome came from. Every result carries one —
   * each is built by spreading its `VerifyPlateInput` — so it is declared
   * rather than left as an undeclared runtime extra.
   */
  imagePath: string;
  /**
   * The plate the QR codes resolved to, in the DB's own casing. Comparison
   * against `assignedPlateId` is case-insensitive internally (plate metadata
   * casing is inconsistent), but the value reported here is for display and
   * keeps whatever casing `GraviPlate.plate_id` holds.
   */
  detectedPlateId: string | null;
  detectedCodes: string[];
  status: VerifyStatus;
  /** Conflicting `plate_id -> qr codes` breakdown, keyed in original casing. */
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
  /**
   * Writes that succeeded but matched zero rows — the run's own state and the
   * database's disagree. Present only when non-empty.
   *
   * `updateMany` on a `where` that matches nothing is not an error in Prisma:
   * it reports success with `count: 0`. Discarding that count let a swap be
   * returned in `swaps[]` with `success: true` when the assignment row it
   * was supposed to rewrite did not exist, which is indistinguishable from a
   * real correction. These are surfaced rather than thrown because the rest
   * of the batch is still valid.
   */
  warnings?: string[];
};

export type VerifyProgressEvent =
  | { type: 'verify-started' }
  // Always the complete result object — the same one that lands in
  // `results[]`. Emitting a hand-built partial from some branches and the
  // full object from others left a renderer unable to rely on any field.
  | { type: 'verify-result'; result: VerifyPlateResult }
  | {
      type: 'verify-complete';
      results: VerifyPlateResult[];
      swaps: PlateSwap[];
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Identity of a physical scanner position within a batch.
 *
 * A batch can span multiple scanners and plate indices repeat across them
 * ("00" exists on every scanner), so `plateIndex` alone is NOT a key. Nor is
 * `assignedPlateId` — the same plate id can legitimately appear on more than
 * one scanner in a batch (e.g. a duplicated assignment). Everything that
 * needs to identify "which plate slot are we talking about" uses this.
 */
function positionKey(position: {
  scannerId: string;
  plateIndex: string;
}): string {
  return `${position.scannerId}::${position.plateIndex}`;
}

/**
 * Every value that reaches a Prisma `where` clause from this module must pass
 * this check first.
 *
 * A truthiness test is NOT sufficient. Prisma silently DROPS a `where` key
 * whose value is `undefined` — `{ experiment_id: undefined, scanner_id: 's1' }`
 * is the query "every experiment's s1 row" — and it accepts a *filter object*
 * (`{ not: 'zzz' }`, `{ startsWith: '' }`) wherever a scalar was intended,
 * which matches essentially everything. Either shape turns a correctly-written
 * scoped `updateMany` into an experiment-wide overwrite of `plate_barcode`,
 * `previous_plate_barcode`, and `verification_status`. The IPC payload is
 * untyped at the boundary, so the type annotations on this module's exported
 * signature are documentation, not enforcement — this is the enforcement.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Fold a plate id for comparison. Plate metadata casing is inconsistent, so
 * every plate-id comparison in this module is case-insensitive — but the
 * stored values keep their original casing (`assignedPlateId` is written back
 * to the DB, `detectedPlateId` is shown to an operator).
 */
function lowerOrNull(value: string | null): string | null {
  return value ? value.toLowerCase() : null;
}

/** Fields of `VerifyPlateInput` that end up in a `where` clause or a write. */
const REQUIRED_PLATE_FIELDS = [
  'scannerId',
  'plateIndex',
  'assignedPlateId',
  'imagePath',
] as const;

/**
 * Drop plate entries that are not fully typed, keeping the rest of the batch.
 *
 * A malformed row is skipped with a warning rather than failing the whole run:
 * that matches this module's per-record error isolation everywhere else (a
 * failed DB write for one plate does not abort the batch either), and one
 * garbled row out of a 40-plate session should not cost the operator the other
 * 39 verifications. An invalid `experimentId`, by contrast, IS fatal — it
 * scopes every write in the run, so there is no safe subset to proceed with.
 */
function filterWellFormedPlates(
  plates: VerifyPlateInput[]
): VerifyPlateInput[] {
  if (!Array.isArray(plates)) {
    console.warn(
      '[GraviScan:VERIFY] Expected an array of plates, got:',
      typeof plates
    );
    return [];
  }

  const wellFormed: VerifyPlateInput[] = [];
  for (const plate of plates) {
    if (!plate || typeof plate !== 'object') {
      console.warn(
        '[GraviScan:VERIFY] Skipping malformed plate entry, not an object:',
        plate
      );
      continue;
    }
    const badFields = REQUIRED_PLATE_FIELDS.filter(
      (field) => !isNonEmptyString((plate as Record<string, unknown>)[field])
    );
    if (badFields.length > 0) {
      console.warn(
        `[GraviScan:VERIFY] Skipping malformed plate entry, ` +
          `expected non-empty strings for: ${badFields.join(', ')} —`,
        plate
      );
      continue;
    }
    wellFormed.push(plate);
  }
  return wellFormed;
}

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
 *
 * `experimentId` is REQUIRED and is threaded into every lookup and every
 * write. `GraviScanPlateAssignment` is unique on
 * `(experiment_id, scanner_id, plate_index)` and a scanner is a long-lived
 * physical device reused across experiments, so a write keyed only on
 * `(scanner_id, plate_index)` can silently overwrite a *different*
 * experiment's historical `plate_barcode`/`verification_status`. There is
 * deliberately no unscoped fallback: a missing `experimentId` fails the run
 * rather than widening the blast radius of every write.
 *
 * `scanOutputDir` is the directory every `imagePath` must resolve inside.
 * It is passed in rather than read from `electron.app` here on purpose: this
 * module depends only on `db` and a QR-reading function, with no Electron
 * import, and the caller (`register-handlers.ts`) already knows the
 * configured output directory.
 */
export async function verifyPlates(
  db: PrismaClient,
  plates: VerifyPlateInput[],
  experimentId: string,
  scanOutputDir: string,
  onProgress?: (event: VerifyProgressEvent) => void
): Promise<VerifyPlatesResult> {
  try {
    // Runtime guard as well as the required type: an untyped IPC payload or
    // a JS caller can still hand us undefined, and proceeding unscoped is
    // exactly the data-corruption path this parameter exists to close. The
    // check is `typeof === 'string'`, not truthiness — see isNonEmptyString().
    if (!isNonEmptyString(experimentId)) {
      const error =
        'experimentId must be a non-empty string — refusing to verify plates ' +
        'without an experiment scope (writes would be able to hit another ' +
        'experiment)';
      console.error(`[GraviScan:VERIFY] ${error}`);
      return { success: false, error, results: [], swaps: [] };
    }

    if (!isNonEmptyString(scanOutputDir)) {
      const error =
        'scanOutputDir must be a non-empty string — refusing to decode plate ' +
        'images without a directory to validate them against';
      console.error(`[GraviScan:VERIFY] ${error}`);
      return { success: false, error, results: [], swaps: [] };
    }

    // Malformed rows are dropped here, before anything can reach a `where`.
    const wellFormedPlates = filterWellFormedPlates(plates);

    console.log(
      `[GraviScan:VERIFY] Verifying ${wellFormedPlates.length} plate(s)...`
    );

    onProgress?.({ type: 'verify-started' });

    const results: VerifyPlateResult[] = [];

    /**
     * Record a write that reported success but matched no rows.
     *
     * Prisma's `updateMany` does not throw when its `where` matches nothing —
     * it returns `{ count: 0 }`. That is a real discrepancy between what this
     * run believes it corrected and what the database holds, and it must not
     * be silently folded into a `success: true` result.
     */
    const warnings: string[] = [];
    const noteWriteMismatch = (message: string) => {
      console.warn(`[GraviScan:VERIFY] ${message}`);
      warnings.push(message);
    };

    // Step 0: validate every imagePath BEFORE it reaches the decoder, using
    // the same realpath-containment check the sibling `read-scan-image`
    // handler applies. A path that escapes the scan output directory (via
    // `..` or a symlink) is dropped from the batch entirely; the plate is
    // reported `unreadable`, since no QR code was — or will be — read for it.
    const resolvedByPlate = new Map<VerifyPlateInput, string>();
    const pathsToDecode: string[] = [];

    for (const plate of wellFormedPlates) {
      const contained = resolveContainedPath(scanOutputDir, plate.imagePath);
      if (!contained.ok) {
        // Manual cast: this repo's tsconfig doesn't set strictNullChecks, so
        // control-flow narrowing on the `ok` discriminant doesn't apply here
        // (same workaround as the disable-scanner handler).
        const reason = (contained as { ok: false; reason: string }).reason;
        if (reason === 'outside') {
          // Resolved cleanly and landed outside the tree — a real containment
          // violation, worth an error-level line.
          console.error(
            '[GraviScan:VERIFY] Rejected imagePath outside the scan output directory:',
            plate.imagePath
          );
        } else {
          // Could not be resolved at all: the capture may not have been
          // written yet, or was moved/removed. Still skipped, but this is the
          // ordinary case — do not log it as a security rejection.
          console.warn(
            '[GraviScan:VERIFY] Skipping plate, image path could not be resolved:',
            plate.imagePath
          );
        }
        continue;
      }
      resolvedByPlate.set(plate, contained.path);
      if (!pathsToDecode.includes(contained.path)) {
        pathsToDecode.push(contained.path);
      }
    }

    // Step 1: Read QR codes from ALL plates in ONE subprocess spawn.
    //
    // Decoding per-plate in a loop would spawn the Python decoder N times per
    // verification, which is exactly what the one-shot-subprocess design
    // (docs/superpowers/specs/2026-07-29-verify-plates-qr-decode-design.md)
    // exists to avoid — the spawn cost is only negligible if it is paid once
    // per session, not once per plate.
    const decoded = await readQrCodesBatch(pathsToDecode);

    const codesByPath = new Map<string, string[]>();
    for (const entry of decoded) {
      codesByPath.set(entry.path, entry.codes);
    }

    // Map results back to plates BY PATH, never by array position — the
    // decoder is free to reorder, and two plates could share an image path.
    const plateReadResults: Array<{
      plate: VerifyPlateInput;
      detectedCodes: string[];
    }> = wellFormedPlates.map((plate) => {
      const resolved = resolvedByPlate.get(plate);
      const detectedCodes: string[] = resolved
        ? (codesByPath.get(resolved) ?? [])
        : [];
      return { plate, detectedCodes };
    });

    // Step 2: Detect duplicate QR codes across plates.
    //
    // A batch can span multiple scanners, and plate indices repeat across
    // them ("00" exists on every scanner). Keying on plateIndex alone
    // conflated unrelated positions in both directions: the same code on two
    // scanners' "00" collapsed to one entry and went undetected, while a
    // genuine duplicate elsewhere on index "00" dragged in every other
    // scanner's "00" plate. The key is the physical position:
    // (scannerId, plateIndex).
    const qrToPositions: Record<string, string[]> = {};
    for (const { plate, detectedCodes } of plateReadResults) {
      const position = positionKey(plate);
      for (const code of detectedCodes) {
        if (!qrToPositions[code]) qrToPositions[code] = [];
        if (!qrToPositions[code].includes(position)) {
          qrToPositions[code].push(position);
        }
      }
    }
    const duplicateQrs = Object.entries(qrToPositions)
      .filter(([, positions]) => positions.length > 1)
      .map(([code]) => code);

    if (duplicateQrs.length > 0) {
      console.warn(
        `[GraviScan:VERIFY] Duplicate QR codes across plates: ${duplicateQrs
          .map((q) => `${q} at ${qrToPositions[q].join(', ')}`)
          .join('; ')}`
      );
    }

    // Positions that carry any duplicate QR code
    const duplicatePositions = new Set<string>();
    for (const code of duplicateQrs) {
      for (const position of qrToPositions[code]) {
        duplicatePositions.add(position);
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
      if (duplicatePositions.has(positionKey(plate))) {
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

      // DB lookup — find plate_id for ALL detected QR codes.
      //
      // Grouping is keyed on the LOWERCASED plate_id, because plate metadata
      // casing is inconsistent and "Plate_13" and "plate_13" are the same
      // plate. The original casing is kept alongside and is what gets
      // reported: lowercasing is a comparison detail, and a renderer showing
      // "plate_13" for a plate physically labelled "Plate_13" makes an
      // operator second-guess a correct read.
      const codesByPlateKey: Record<string, string[]> = {};
      const displayIdByPlateKey: Record<string, string> = {};
      let detectedPlateKey: string | null = null;
      let detectedPlateId: string | null = null;
      let isInconsistent = false;
      let lookupFailed = false;

      try {
        // Scope query to experiment's accession to avoid cross-experiment
        // matches. `experimentId` is guaranteed non-empty by the guard at the
        // top of this function, so there is no unscoped branch here.
        const accessionFilter = {
          plate: {
            metadata_file: {
              experiments: { some: { id: experimentId } },
            },
          },
        };

        const mappings = await db.graviPlateSectionMapping.findMany({
          where: {
            plant_qr: { in: detectedCodes },
            ...accessionFilter,
          },
          include: {
            plate: true,
          },
        });

        // Group QR codes by their plate_id (case-insensitive to handle
        // metadata inconsistencies), remembering the first casing seen.
        for (const mapping of mappings) {
          if (mapping.plate) {
            const key = mapping.plate.plate_id.toLowerCase();
            if (!codesByPlateKey[key]) {
              codesByPlateKey[key] = [];
              displayIdByPlateKey[key] = mapping.plate.plate_id;
            }
            codesByPlateKey[key].push(mapping.plant_qr);
          }
        }

        const plateKeys = Object.keys(codesByPlateKey);

        if (plateKeys.length === 1) {
          // All codes agree — use that plate_id
          detectedPlateKey = plateKeys[0];
        } else if (plateKeys.length > 1) {
          // Codes disagree — find majority
          isInconsistent = true;
          let maxCount = 0;
          for (const [key, codes] of Object.entries(codesByPlateKey)) {
            if (codes.length > maxCount) {
              maxCount = codes.length;
              detectedPlateKey = key;
            }
          }
          console.warn(
            `[GraviScan:VERIFY] Inconsistent QR mappings on ${plate.plateIndex}: ${JSON.stringify(codesByPlateKey)}`
          );
        }

        detectedPlateId = detectedPlateKey
          ? displayIdByPlateKey[detectedPlateKey]
          : null;
      } catch (lookupErr) {
        // The lookup, NOT the image, is what failed. Falling through to
        // `unreadable` here would be the same status-collapse this module
        // deliberately refuses to make for `incorrect`: it would tell the
        // operator to go re-image a plate whose scan was fine, and would
        // persist a reason that is not the real one. A transient locked
        // database on a rig is exactly the case that produces this.
        lookupFailed = true;
        console.error('[GraviScan:VERIFY] DB lookup failed:', lookupErr);
      }

      // Determine status
      let status: VerifyStatus;
      if (lookupFailed) {
        // Nothing is known about this plate — it is neither verified nor
        // incorrect, and it must not be paired into a swap.
        status = 'lookup_failed';
        detectedPlateKey = null;
        detectedPlateId = null;
      } else if (isInconsistent) {
        // QR codes map to different plates — flag for manual review, don't auto-correct
        status = 'needs_review';
      } else if (!detectedPlateKey) {
        status = 'unreadable';
        // Comparison is on the lowercased KEY, not on the display value. Real
        // plate IDs here are mixed-case ("Plate_13"); comparing the lowercased
        // DB value against a raw assignedPlateId never matched and every
        // correct plate read `incorrect`.
      } else if (detectedPlateKey === plate.assignedPlateId.toLowerCase()) {
        status = 'verified';
      } else {
        status = 'incorrect';
      }

      const result: VerifyPlateResult = {
        ...plate,
        detectedPlateId,
        detectedCodes,
        status,
        ...(isInconsistent
          ? {
              // Re-keyed to the original casing: this breakdown is shown to an
              // operator, same as detectedPlateId.
              inconsistentMappings: Object.fromEntries(
                Object.entries(codesByPlateKey).map(([key, codes]) => [
                  displayIdByPlateKey[key],
                  codes,
                ])
              ),
            }
          : {}),
      };

      results.push(result);

      // The full result object, same as every other branch — see
      // VerifyProgressEvent.
      onProgress?.({ type: 'verify-result', result });
    }

    // Detect swaps — two incorrect results where each detected the other's
    // assigned plate_id.
    //
    // Pairing and dedup are keyed on the physical position
    // (scannerId, plateIndex), NOT on assignedPlateId. The same plate id can
    // appear on more than one scanner in a batch; keying on it collapsed two
    // genuinely independent swap pairs into one and left the second pair
    // uncorrected. `pairedPositions` also guarantees a position is consumed
    // by at most one swap, so a shared reciprocal partner cannot be
    // double-booked.
    const swaps: PlateSwap[] = [];
    const pairedPositions = new Set<string>();

    const incorrectResults = results.filter(
      (r) => r.status === 'incorrect' && r.detectedPlateId
    );

    for (const result of incorrectResults) {
      if (pairedPositions.has(positionKey(result))) continue;

      // Both sides are folded to lower case for the comparison only; neither
      // stored value is mutated (assignedPlateId is what gets written back to
      // the DB, so it must keep its original casing, and detectedPlateId is
      // reported for display).
      // Distinctness is by POSITION, not object identity: two input rows that
      // both claim the same (scannerId, plateIndex) — which the DB's unique
      // constraint forbids but nothing stops a caller from passing — would
      // otherwise "swap" a position with itself and emit a bogus correction.
      const isReciprocal = (other: VerifyPlateResult) =>
        positionKey(other) !== positionKey(result) &&
        !pairedPositions.has(positionKey(other)) &&
        lowerOrNull(other.detectedPlateId) ===
          result.assignedPlateId.toLowerCase() &&
        lowerOrNull(result.detectedPlateId) ===
          other.assignedPlateId.toLowerCase();

      // Prefer a partner on the same scanner: plates are physically loaded
      // per-scanner, so a same-scanner mix-up is by far the likelier
      // explanation. This tie-break also decides which position stays
      // `incorrect` in an ambiguous batch: a cross-scanner candidate loses to
      // a same-scanner one and, if it has no other partner, is left
      // uncorrected rather than mis-paired. Genuine cross-scanner swaps are
      // still detected by the fallback below.
      //
      // It narrows, but does NOT eliminate, the influence of input order:
      // pairing is still greedy and first-come, so with three or more mutually
      // reciprocal positions on one scanner, which pair forms depends on the
      // order the caller submitted them in. The guarantee is only that a
      // same-scanner candidate is never passed over for a cross-scanner one.
      const swapMatch =
        incorrectResults.find(
          (other) => other.scannerId === result.scannerId && isReciprocal(other)
        ) ?? incorrectResults.find(isReciprocal);

      if (swapMatch) {
        pairedPositions.add(positionKey(result));
        pairedPositions.add(positionKey(swapMatch));
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

    // Perform database corrections for detected swaps
    for (const swap of swaps) {
      const { position1, position2 } = swap;
      console.log(
        `[GraviScan:VERIFY] Correcting swap: ${position1.assignedPlateId} <-> ${position2.assignedPlateId}`
      );

      try {
        // All four writes for this pair are ONE atomic unit.
        //
        // Bare, a failure between them left the assignment corrected but the
        // scan records not (or vice versa): the plate assignment and the scan
        // history would then disagree about which plate sat in that position,
        // with nothing in the data to say which one is right. The
        // transactional boundary is deliberately per-SWAP-PAIR rather than
        // per-batch, so one bad pair still cannot abort the corrections for
        // the others — the existing per-pair try/catch below stays.
        const counts = await db.$transaction(async (tx) => {
          // 1. Swap plate_barcode in GraviScanPlateAssignment.
          //    Every `where` below carries experiment_id, matching the real
          //    @@unique([experiment_id, scanner_id, plate_index]) constraint.
          const assignment1 = await tx.graviScanPlateAssignment.updateMany({
            where: {
              experiment_id: experimentId,
              scanner_id: position1.scannerId,
              plate_index: position1.plateIndex,
            },
            data: {
              plate_barcode: position2.assignedPlateId,
              // Audit trail: record what this position was corrected FROM, in
              // the same write. Without it, "this row used to say Plate_13"
              // only exists in application logs, which are not queryable and
              // do not survive a log rotation.
              previous_plate_barcode: position1.assignedPlateId,
            },
          });
          const assignment2 = await tx.graviScanPlateAssignment.updateMany({
            where: {
              experiment_id: experimentId,
              scanner_id: position2.scannerId,
              plate_index: position2.plateIndex,
            },
            data: {
              plate_barcode: position1.assignedPlateId,
              previous_plate_barcode: position2.assignedPlateId,
            },
          });

          // 2. Swap plate_barcode in the GraviScan records (scan image
          //    records) for BOTH positions.
          //
          //    This is a set-based updateMany, not `findFirst({ orderBy:
          //    capture_date desc }) + update`. A time-lapse session writes one
          //    GraviScan row per cycle for the same scanner/position, so
          //    correcting only the newest row left every earlier cycle
          //    carrying the wrong plate_barcode — and graviscan-upload.ts
          //    reads plate_barcode PER ROW, so those cycles would have
          //    uploaded to Bloom and Box under the wrong plate. A mis-loaded
          //    plate is wrong for every cycle it was scanned in, not just the
          //    last one.
          //
          //    Scope is (experiment_id, scanner_id, plate_index) plus the
          //    PRE-correction plate_barcode. That last filter is what makes
          //    this safe and idempotent: only rows that still carry the wrong
          //    value are touched, so a re-run (or a partially-applied earlier
          //    run) cannot swap anything back. Scoping instead by session_id
          //    was the alternative considered; it would need a new parameter
          //    threaded through the whole call chain and would still leave the
          //    other sessions of the same experiment wrong.
          const scan1 = await tx.graviScan.updateMany({
            where: {
              experiment_id: experimentId,
              scanner_id: position1.scannerId,
              plate_index: position1.plateIndex,
              plate_barcode: position1.assignedPlateId,
              deleted: false,
            },
            data: { plate_barcode: position2.assignedPlateId },
          });
          const scan2 = await tx.graviScan.updateMany({
            where: {
              experiment_id: experimentId,
              scanner_id: position2.scannerId,
              plate_index: position2.plateIndex,
              plate_barcode: position2.assignedPlateId,
              deleted: false,
            },
            data: { plate_barcode: position1.assignedPlateId },
          });

          return { assignment1, assignment2, scan1, scan2 };
        });

        // 3. Reconcile what the writes actually matched against what this run
        //    expected. A swap pair implies four rows exist; a zero count means
        //    the DB does not hold what the caller's assignments claimed.
        for (const [position, assignmentCount] of [
          [position1, counts.assignment1.count],
          [position2, counts.assignment2.count],
        ] as const) {
          if (assignmentCount === 0) {
            noteWriteMismatch(
              `Swap correction matched 0 GraviScanPlateAssignment row(s) for ` +
                `${experimentId}/${position.scannerId}/${position.plateIndex} — ` +
                `the corrected plate_barcode was NOT persisted`
            );
          }
        }
        for (const [position, scanCount] of [
          [position1, counts.scan1.count],
          [position2, counts.scan2.count],
        ] as const) {
          if (scanCount === 0) {
            noteWriteMismatch(
              `Swap correction matched 0 GraviScan record(s) for ` +
                `${experimentId}/${position.scannerId}/${position.plateIndex} ` +
                `carrying plate_barcode "${position.assignedPlateId}" — ` +
                `scan records were NOT corrected and will upload under the ` +
                `pre-correction plate`
            );
          }
        }

        // 4. Log swap for audit trail. Only reached once the transaction has
        //    actually committed — a rolled-back pair must not be logged as
        //    corrected.
        console.log(
          `[GraviScan:VERIFY] Swap corrected: ` +
            `${position1.assignedPlateId} (${position1.scannerId}:${position1.plateIndex}) <-> ` +
            `${position2.assignedPlateId} (${position2.scannerId}:${position2.plateIndex}) ` +
            `[${counts.scan1.count} + ${counts.scan2.count} GraviScan record(s)]`
        );
      } catch (swapErr) {
        console.error('[GraviScan:VERIFY] Failed to correct swap:', swapErr);
      }
    }

    // Update verification_status in DB
    for (const result of results) {
      // An `incorrect` plate that turned out to be half of a detected swap
      // has been auto-corrected, so it records `swapped`. An `incorrect`
      // plate with no swap partner records `incorrect` — deliberately NOT
      // collapsed into `unreadable` the way production does. "QR read fine,
      // wrong plate" and "QR could not be read at all" need different
      // operator responses and must stay distinguishable in the data.
      //
      // The upgrade is written back onto the result itself, not just into the
      // DB write: leaving results[].status at `incorrect` while the row said
      // `swapped` meant the returned payload and the row this run had just
      // written disagreed about the same plate. Swap detection needs the whole
      // batch, so this can only be known here — the per-plate `verify-result`
      // event has already gone out with `incorrect`, and `verify-complete`
      // carries these same (now upgraded) objects.
      //
      // Membership is tested by position, not by assignedPlateId: an
      // uncorrected plate sharing a plate id with a swapped one elsewhere in
      // the batch must not inherit `swapped`.
      if (
        result.status === 'incorrect' &&
        pairedPositions.has(positionKey(result))
      ) {
        result.status = 'swapped';
      }
      const finalStatus: VerifyStatus = result.status;

      try {
        const statusWrite = await db.graviScanPlateAssignment.updateMany({
          where: {
            experiment_id: experimentId,
            scanner_id: result.scannerId,
            plate_index: result.plateIndex,
          },
          data: {
            verification_status: finalStatus,
          },
        });
        if (statusWrite.count === 0) {
          noteWriteMismatch(
            `verification_status "${finalStatus}" matched 0 ` +
              `GraviScanPlateAssignment row(s) for ` +
              `${experimentId}/${result.scannerId}/${result.plateIndex} — ` +
              `the outcome for this plate was NOT persisted`
          );
        }
      } catch (dbErr) {
        console.error(
          '[GraviScan:VERIFY] Failed to update verification_status:',
          dbErr
        );
      }
    }

    // Every paired position has already had its status upgraded to `swapped`
    // above, so `incorrect` here means exactly "wrong plate, no partner".
    const verified = results.filter((r) => r.status === 'verified').length;
    const unreadable = results.filter((r) => r.status === 'unreadable').length;
    const incorrect = results.filter((r) => r.status === 'incorrect').length;
    const needsReview = results.filter(
      (r) => r.status === 'needs_review'
    ).length;
    const duplicates = results.filter(
      (r) => r.status === 'duplicate_qr'
    ).length;
    const lookupFailures = results.filter(
      (r) => r.status === 'lookup_failed'
    ).length;

    console.log(
      `[GraviScan:VERIFY] Complete: ${verified} verified, ${swaps.length} swaps, ${incorrect} incorrect, ${unreadable} unreadable, ${needsReview} needs_review, ${duplicates} duplicate_qr, ${lookupFailures} lookup_failed`
    );

    if (warnings.length > 0) {
      console.warn(
        `[GraviScan:VERIFY] ${warnings.length} write(s) matched no rows — ` +
          `this run's view of the database is not what was persisted`
      );
    }

    onProgress?.({ type: 'verify-complete', results, swaps });

    return {
      success: true,
      results,
      swaps,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
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
