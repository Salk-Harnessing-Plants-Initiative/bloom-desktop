/**
 * Prepares a GraviScan session in the main process when Start Scan is
 * received. The renderer sends only what the operator chose (experiment,
 * phenotyper, wave, scanners in page order, plates). As on the rig, each
 * plate gets the parts of its file name and the worker builds the name when
 * it saves; here the parts come from the database and `scan-filename.ts`,
 * every path is checked to be inside the output folder. The worker creates
 * the session folder when it saves the first image, so a start that fails
 * later leaves no empty folder behind.
 */
import * as path from 'path';
import type { GridMode, PlateConfig } from '../../types/graviscan';
import { resolveContainedPathAllowingMissing } from './path-containment';
import {
  buildScanFileName,
  buildScannerTag,
  buildSessionDirName,
  buildSystemPrefix,
  composeScanFileName,
  formatScanTimestamp,
  sanitizeExpName,
} from './scan-filename';

/** First cycle of a session; the coordinator sets it for later cycles. */
const FIRST_CYCLE = 1;

const MALFORMED = 'Malformed start-scan request';

/** Refusal when a built path would land outside the GraviScan output folder. */
function outsideOutputFolder(outputDir: string): string {
  return (
    `Can't save scans there: the scan folder would be outside the GraviScan ` +
    `output folder (${outputDir}), for example through a link. Check ` +
    `GRAVISCAN_OUTPUT_DIR in ~/.bloom/.env.`
  );
}

export interface StartScanLookupLike {
  experiment: {
    findUnique(args: {
      where: { id: string };
      select: { name: true };
    }): Promise<{ name: string } | null>;
  };
  phenotyper: {
    findUnique(args: {
      where: { id: string };
      select: { name: true };
    }): Promise<{ name: string } | null>;
  };
  graviScanner: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; name: true; display_name: true };
    }): Promise<{ id: string; name: string; display_name: string | null }[]>;
  };
}

export interface StartScanPlateRequest {
  plate_index: string;
  grid_mode: GridMode;
  resolution: number;
  plate_barcode?: string | null;
}

export interface StartScanScannerRequest {
  scannerId: string;
  saneName: string;
  plates: StartScanPlateRequest[];
}

export interface StartScanPathRequest {
  /** Every enabled scanner in page order; sets `Sc{K}`, as on the rig. */
  scannerOrder: string[];
  /** Scanners that have plates to scan. */
  scanners: StartScanScannerRequest[];
  metadata: {
    experimentId: string;
    phenotyperId: string;
    resolution: number;
    waveNumber: number;
  };
}

export type StartScanPlate = PlateConfig & { plate_barcode?: string | null };

export interface StartScanPlanScanner {
  scannerId: string;
  saneName: string;
  plates: StartScanPlate[];
}

export type StartScanPlan =
  | {
      ok: true;
      scanners: StartScanPlanScanner[];
      /** Output path per job key `${scannerId}:${plateIndex}`. */
      outputPaths: Record<string, string>;
      sessionDir: string;
    }
  | { ok: false; error: string };

export interface StartScanPathDeps {
  db: StartScanLookupLike;
  outputDir: string;
  /** `GRAVISCAN_SYSTEM_NAME`; empty when not set. */
  systemName: string;
  now: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Shape check of the untrusted request; returns an error or null. */
function requestShapeError(req: unknown): string | null {
  if (!isRecord(req) || !isRecord(req.metadata)) return MALFORMED;
  if (!Array.isArray(req.scannerOrder) || !Array.isArray(req.scanners)) {
    return MALFORMED;
  }
  const order = req.scannerOrder as unknown[];
  if (!order.every((id) => typeof id === 'string')) return MALFORMED;
  const m = req.metadata;
  if (
    typeof m.experimentId !== 'string' ||
    typeof m.phenotyperId !== 'string'
  ) {
    return MALFORMED;
  }
  for (const s of req.scanners as unknown[]) {
    if (
      !isRecord(s) ||
      typeof s.scannerId !== 'string' ||
      typeof s.saneName !== 'string' ||
      !Array.isArray(s.plates) ||
      !order.includes(s.scannerId)
    ) {
      return `${MALFORMED}: each scanner must be in the scanner order and include a plates array`;
    }
    for (const p of s.plates as unknown[]) {
      if (!isRecord(p) || typeof p.plate_index !== 'string') {
        return `${MALFORMED}: each plate must include a plate_index`;
      }
    }
  }
  return null;
}

/**
 * Validate the request, look up the names, build every path, check each is
 * inside the output folder, and create the session folder. Nothing is
 * created when any check fails.
 */
export async function buildStartScanPlan(
  deps: StartScanPathDeps,
  req: StartScanPathRequest
): Promise<StartScanPlan> {
  const shapeError = requestShapeError(req);
  if (shapeError) return { ok: false, error: shapeError };

  const { experimentId, phenotyperId, waveNumber } = req.metadata;
  const totalPlates = req.scanners.reduce((n, s) => n + s.plates.length, 0);
  if (totalPlates === 0) {
    return { ok: false, error: 'No plates selected for scanning.' };
  }

  const experiment = await deps.db.experiment.findUnique({
    where: { id: experimentId },
    select: { name: true },
  });
  if (!experiment) {
    return {
      ok: false,
      error:
        'The selected experiment no longer exists. Choose the experiment again.',
    };
  }
  const phenotyper = await deps.db.phenotyper.findUnique({
    where: { id: phenotyperId },
    select: { name: true },
  });
  if (!phenotyper) {
    return {
      ok: false,
      error:
        'The selected phenotyper no longer exists. Choose the phenotyper again.',
    };
  }

  const scannerIds = req.scanners.map((s) => s.scannerId);
  const scannerRows = await deps.db.graviScanner.findMany({
    where: { id: { in: scannerIds } },
    select: { id: true, name: true, display_name: true },
  });
  const scannerNames = new Map(
    scannerRows.map((r) => [r.id, r.display_name || r.name])
  );
  const unknown = scannerIds.find((id) => !scannerNames.has(id));
  if (unknown) {
    return {
      ok: false,
      error:
        'A selected scanner is no longer in the scanner list. Open Configure ' +
        'Scanner, detect and save the scanners again, then start the scan.',
    };
  }

  const startedAt = deps.now();
  const stTimestamp = formatScanTimestamp(startedAt);

  let plan: Extract<StartScanPlan, { ok: true }>;
  try {
    const sessionDir = resolveContainedPathAllowingMissing(
      deps.outputDir,
      path.join(
        deps.outputDir,
        buildSessionDirName({ expName: experiment.name, waveNumber, startedAt })
      )
    );
    if (!sessionDir.ok) throw new Error(outsideOutputFolder(deps.outputDir));
    const systemPrefix = buildSystemPrefix(deps.systemName);
    const outputPaths: Record<string, string> = {};
    const scanners = req.scanners.map((s) => {
      const scannerIndex = req.scannerOrder.indexOf(s.scannerId);
      return {
        scannerId: s.scannerId,
        saneName: s.saneName,
        plates: s.plates.map((p): StartScanPlate => {
          const key = `${s.scannerId}:${p.plate_index}`;
          if (key in outputPaths) {
            throw new Error(
              `Plate ${p.plate_index} is listed twice for one scanner`
            );
          }
          // Planned name (no `_et_`): checks every part, and is what the page
          // tracks; the worker builds the real name from the parts below.
          const planned = resolveContainedPathAllowingMissing(
            deps.outputDir,
            path.join(
              sessionDir.path,
              buildScanFileName({
                expName: experiment.name,
                waveNumber,
                stTimestamp,
                cycle: FIRST_CYCLE,
                systemName: deps.systemName,
                scannerIndex,
                plateIndex: p.plate_index,
              })
            )
          );
          if (!planned.ok) throw new Error(outsideOutputFolder(deps.outputDir));
          outputPaths[key] = planned.path;
          return {
            plate_index: p.plate_index,
            grid_mode: p.grid_mode,
            resolution: p.resolution,
            output_dir: sessionDir.path,
            exp_name: sanitizeExpName(experiment.name),
            experiment_name: experiment.name,
            wave_number: waveNumber,
            st_timestamp: stTimestamp,
            cycle: FIRST_CYCLE,
            system_prefix: systemPrefix,
            scanner_tag: buildScannerTag(scannerIndex),
            phenotyper_name: phenotyper.name,
            scanner_name: scannerNames.get(s.scannerId),
            plate_barcode: p.plate_barcode ?? null,
          };
        }),
      };
    });
    plan = { ok: true, scanners, outputPaths, sessionDir: sessionDir.path };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
  return plan;
}

/** Test scan request: one scan of every plate, no experiment. */
export interface TestScanPathRequest {
  test: true;
  scanners: StartScanScannerRequest[];
}

export interface TestScanPathDeps {
  outputDir: string;
  now: () => Date;
}

/** Folder under the output folder that holds test scans. */
const TEST_SCAN_DIR = 'test';

/** A scanner id: letters, digits, `-` and `_` only. */
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Characters of the scanner id in a test scan's name (rig rule). */
const TEST_SCAN_ID_CHARS = 8;

/** Wave number in a test scan's name (rig rule: test scans have no wave). */
const TEST_SCAN_WAVE = 0;

/**
 * Parts for a test scan, as the rig names them (rig `useTestScan.ts`):
 * `test-{first 8 characters of the scanner id}`, wave 0, cycle 1, no system
 * name, `Sc{K}` by the scanner's position in the request. Saved under
 * `{outputDir}/test/` so test files stay apart from session folders. The
 * worker creates that folder when it saves.
 */
export async function buildTestScanPlan(
  deps: TestScanPathDeps,
  req: TestScanPathRequest
): Promise<StartScanPlan> {
  if (!isRecord(req) || !Array.isArray(req.scanners)) {
    return { ok: false, error: MALFORMED };
  }
  const contained = resolveContainedPathAllowingMissing(
    deps.outputDir,
    path.join(deps.outputDir, TEST_SCAN_DIR)
  );
  if (!contained.ok) {
    return { ok: false, error: outsideOutputFolder(deps.outputDir) };
  }
  const testDir = contained.path;
  const stTimestamp = formatScanTimestamp(deps.now());
  const outputPaths: Record<string, string> = {};
  const scanners: StartScanPlanScanner[] = [];
  const requested = req.scanners as unknown[];
  for (const [index, s] of requested.entries()) {
    if (
      !isRecord(s) ||
      typeof s.scannerId !== 'string' ||
      !SAFE_ID_PATTERN.test(s.scannerId) ||
      typeof s.saneName !== 'string' ||
      !Array.isArray(s.plates)
    ) {
      return { ok: false, error: `${MALFORMED}: invalid scanner` };
    }
    const expName = `test-${s.scannerId.slice(0, TEST_SCAN_ID_CHARS)}`;
    const plates: StartScanPlate[] = [];
    for (const p of s.plates as StartScanPlateRequest[]) {
      if (
        !isRecord(p) ||
        typeof p.plate_index !== 'string' ||
        !/^\d{2}$/.test(p.plate_index)
      ) {
        return { ok: false, error: `${MALFORMED}: invalid plate index` };
      }
      if (`${s.scannerId}:${p.plate_index}` in outputPaths) {
        return {
          ok: false,
          error: `Plate ${p.plate_index} is listed twice for one scanner`,
        };
      }
      const parts = {
        exp_name: expName,
        wave_number: TEST_SCAN_WAVE,
        st_timestamp: stTimestamp,
        cycle: FIRST_CYCLE,
        system_prefix: '',
        scanner_tag: buildScannerTag(index),
        plate_index: p.plate_index,
      };
      outputPaths[`${s.scannerId}:${p.plate_index}`] = path.join(
        testDir,
        composeScanFileName(parts)
      );
      plates.push({
        plate_index: p.plate_index,
        grid_mode: p.grid_mode,
        resolution: p.resolution,
        output_dir: testDir,
        ...parts,
        phenotyper_name: '',
      });
    }
    scanners.push({
      scannerId: s.scannerId,
      saneName: s.saneName,
      plates,
    });
  }
  if (Object.keys(outputPaths).length === 0) {
    return { ok: false, error: 'No plates selected for the test scan.' };
  }
  return { ok: true, scanners, outputPaths, sessionDir: testDir };
}
