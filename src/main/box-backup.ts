/**
 * Box Backup via rclone
 *
 * After scans are uploaded to Bloom (Supabase), backs up raw TIF files
 * to Box via `rclone copy`. Files are organized per experiment:
 *
 *   Box:GraviScan-Backups/
 *     ExperimentName/
 *       wave_0/
 *         ExperimentName_st_..._cy1_S1_00.tif
 *         metadata.csv
 *       wave_1/
 *         ...
 *
 * rclone copy automatically skips files that already exist at the destination.
 * If rclone is not installed, logs a warning and skips.
 */

import { PrismaClient } from '@prisma/client';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveGraviScanPath } from './graviscan-path-utils';

const RCLONE_REMOTE = 'Box';
const BOX_BASE_PATH = 'Graviscan-Backups';

export interface BoxBackupProgress {
  totalImages: number;
  completedImages: number;
  failedImages: number;
  currentExperiment: string;
}

export interface BoxBackupResult {
  success: boolean;
  experiments: number;
  filesCopied: number;
  errors: string[];
}

/**
 * Check if rclone is available on PATH.
 */
function isRcloneInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('which', ['rclone'], (error) => {
      resolve(!error);
    });
  });
}

/**
 * Run rclone copy for a list of source files to a Box destination folder.
 * Uses a temp directory with symlinks to copy only the specific files.
 */
function rcloneCopyFiles(
  filePaths: string[],
  boxDestination: string,
  onFileComplete?: (filename: string) => void
): Promise<{ success: boolean; erroredFiles: Set<string>; error?: string }> {
  return new Promise((resolve) => {
    // Create a temp directory with symlinks to the files we want to copy
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graviscan-backup-'));

    try {
      let symlinksCreated = 0;
      const missingFiles: string[] = [];
      const missingFileNames = new Set<string>();
      for (const filePath of filePaths) {
        const resolvedPath = resolveGraviScanPath(filePath);
        if (resolvedPath) {
          const fileName = path.basename(resolvedPath);
          const linkPath = path.join(tmpDir, fileName);
          fs.symlinkSync(resolvedPath, linkPath);
          symlinksCreated++;
        } else {
          missingFiles.push(filePath);
          missingFileNames.add(path.basename(filePath));
        }
      }

      console.log(
        `[BoxBackup] rcloneCopyFiles: ${symlinksCreated}/${filePaths.length} files found on disk`
      );
      if (missingFiles.length > 0) {
        console.warn(
          `[BoxBackup] Missing files (first 5):`,
          missingFiles.slice(0, 5)
        );
      }

      // If no files exist on disk, fail immediately — don't run rclone on empty dir
      if (symlinksCreated === 0 && filePaths.length > 0) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
        resolve({
          success: false,
          erroredFiles: missingFileNames,
          error: `None of the ${filePaths.length} image files exist on disk`,
        });
        return;
      }

      const proc = spawn('rclone', [
        'copy',
        tmpDir,
        `${RCLONE_REMOTE}:${boxDestination}`,
        '--copy-links', // follow symlinks
        '--use-json-log',
        '--log-level',
        'INFO',
      ]);

      const erroredFiles = new Set<string>(missingFileNames);
      let stderrBuffer = '';
      proc.stderr.on('data', (data: Buffer) => {
        stderrBuffer += data.toString();
        // Parse complete lines as they stream in
        const lines = stderrBuffer.split('\n');
        stderrBuffer = lines.pop() || ''; // keep incomplete last line in buffer
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.level === 'error' && entry.msg) {
              const filename = entry.msg.split(':')[0].trim();
              if (filename) erroredFiles.add(filename);
            } else if (
              entry.level === 'info' &&
              entry.msg &&
              /: Copied \(/.test(entry.msg)
            ) {
              const filename = entry.msg.split(':')[0].trim();
              if (filename) onFileComplete?.(filename);
            }
          } catch {
            // skip non-JSON lines
          }
        }
      });

      proc.on('close', (code) => {
        // Parse any remaining buffered line
        if (stderrBuffer.trim()) {
          try {
            const entry = JSON.parse(stderrBuffer);
            if (entry.level === 'error' && entry.msg) {
              const filename = entry.msg.split(':')[0].trim();
              if (filename) erroredFiles.add(filename);
            } else if (
              entry.level === 'info' &&
              entry.msg &&
              /: Copied \(/.test(entry.msg)
            ) {
              const filename = entry.msg.split(':')[0].trim();
              if (filename) onFileComplete?.(filename);
            }
          } catch {
            // skip
          }
        }

        // Clean up temp dir
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors
        }

        if (code === 0 && erroredFiles.size === 0) {
          resolve({ success: true, erroredFiles });
        } else {
          resolve({
            success: false,
            erroredFiles,
            error: code !== 0 ? `rclone exited with code ${code}` : undefined,
          });
        }
      });

      proc.on('error', (err) => {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
        resolve({
          success: false,
          erroredFiles: new Set(),
          error: err.message,
        });
      });
    } catch (err) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      resolve({
        success: false,
        erroredFiles: new Set(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

/**
 * Copy a single file (e.g. metadata.csv) to a Box destination folder.
 * Uses a temp directory with the file copied in, then rclone copy (same
 * pattern as image uploads) to avoid rclone copyto source-directory issues.
 */
function rcloneCopyFile(
  filePath: string,
  destFileName: string,
  boxDestination: string
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    // Create a temp directory containing a copy/link of the file with the desired name
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graviscan-csv-'));
    const tmpFilePath = path.join(tmpDir, destFileName);

    try {
      fs.copyFileSync(filePath, tmpFilePath);
    } catch (err) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      resolve({
        success: false,
        error: `Failed to prepare file: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    const proc = spawn('rclone', [
      'copy',
      tmpDir,
      `${RCLONE_REMOTE}:${boxDestination}`,
      '--copy-links',
    ]);

    let stderr = '';
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({
          success: false,
          error: `rclone exited with code ${code}: ${stderr}`,
        });
      }
    });

    proc.on('error', (err) => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      resolve({ success: false, error: err.message });
    });
  });
}

interface ScanRow {
  wave_number: number;
  plate_barcode: string | null;
  plate_index: string;
  grid_mode: string;
  capture_date: Date;
  accession: string;
  transplant_date: Date | null;
  custom_note: string | null;
  image_filename: string;
}

interface PlateRow {
  plate_id: string;
  accession: string;
  transplant_date: Date | null;
  custom_note: string | null;
}

interface SectionRow {
  plate_id: string;
  section_id: string;
  plant_qr: string;
  medium: string | null;
}

// CSV cells may carry commas, quotes, or newlines (from custom_note free text).
// Quote any cell containing those and escape embedded quotes.
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Per-scan metadata (one row per image).
 */
function exportMetadataCSV(
  experimentName: string,
  scanRows: ScanRow[]
): string {
  const rows: string[] = [];
  rows.push(
    'experiment,wave_number,plate_barcode,plate_index,grid_mode,capture_date,accession,transplant_date,custom_note,image_filename'
  );

  for (const r of scanRows) {
    rows.push(
      [
        csvCell(experimentName),
        csvCell(r.wave_number),
        csvCell(r.plate_barcode),
        csvCell(r.plate_index),
        csvCell(r.grid_mode),
        csvCell(r.capture_date.toISOString()),
        csvCell(r.accession),
        csvCell(
          r.transplant_date ? r.transplant_date.toISOString().split('T')[0] : ''
        ),
        csvCell(r.custom_note),
        csvCell(r.image_filename),
      ].join(',')
    );
  }

  return rows.join('\n') + '\n';
}

/**
 * Per-plate metadata (one row per plate in the wave's linked accession).
 * Comes from GraviPlateAccession + GraviExperimentWaveMetadata lookup.
 */
function exportPlatesCSV(
  experimentName: string,
  waveNumber: number,
  plateRows: PlateRow[]
): string {
  const rows: string[] = [];
  rows.push(
    'experiment,wave_number,plate_id,accession,transplant_date,custom_note'
  );
  for (const p of plateRows) {
    rows.push(
      [
        csvCell(experimentName),
        csvCell(waveNumber),
        csvCell(p.plate_id),
        csvCell(p.accession),
        csvCell(
          p.transplant_date ? p.transplant_date.toISOString().split('T')[0] : ''
        ),
        csvCell(p.custom_note),
      ].join(',')
    );
  }
  return rows.join('\n') + '\n';
}

/**
 * Per-section metadata (one row per plate section in the wave's linked accession).
 * Comes from GraviPlateSectionMapping joined to the wave's plates.
 */
function exportSectionsCSV(
  experimentName: string,
  waveNumber: number,
  sectionRows: SectionRow[]
): string {
  const rows: string[] = [];
  rows.push('experiment,wave_number,plate_id,section_id,plant_qr,medium');
  for (const s of sectionRows) {
    rows.push(
      [
        csvCell(experimentName),
        csvCell(waveNumber),
        csvCell(s.plate_id),
        csvCell(s.section_id),
        csvCell(s.plant_qr),
        csvCell(s.medium),
      ].join(',')
    );
  }
  return rows.join('\n') + '\n';
}

/**
 * Run Box backup for all uploaded images, organized by experiment.
 *
 * Queries the DB for uploaded images, groups by experiment name,
 * copies TIF files + metadata CSV to Box:GraviScan-Backups/<experiment>/.
 *
 * This is non-blocking from the caller's perspective when awaited —
 * it runs rclone as child processes sequentially per experiment.
 */
export async function runBoxBackup(
  db: PrismaClient,
  onProgress?: (progress: BoxBackupProgress) => void
): Promise<BoxBackupResult> {
  const systemName = process.env.GRAVISCAN_SYSTEM_NAME || '';

  const result: BoxBackupResult = {
    success: true,
    experiments: 0,
    filesCopied: 0,
    errors: [],
  };

  // Check if rclone is installed
  const hasRclone = await isRcloneInstalled();
  if (!hasRclone) {
    console.warn('[BoxBackup] rclone not installed — skipping Box backup');
    return { ...result, success: false, errors: ['rclone not installed'] };
  }

  console.log('[BoxBackup] Starting Box backup...');

  // Query for images pending Box backup
  const scans = await db.graviScan.findMany({
    where: {
      deleted: false,
      images: {
        some: { box_status: { in: ['pending', 'failed'] } },
      },
    },
    include: {
      images: { where: { box_status: { in: ['pending', 'failed'] } } },
      experiment: {
        include: {
          accession: {
            include: {
              graviPlateAccessions: {
                include: { sections: true },
              },
            },
          },
        },
      },
    },
  });

  if (scans.length === 0) {
    console.log('[BoxBackup] No uploaded images to back up');
    return result;
  }

  // Wave-aware metadata lookup: (experiment_id, wave_number) → linked accession's plates.
  // GraviScan experiments link metadata via GraviExperimentWaveMetadata (one per wave),
  // not via the legacy Experiment.accession_id. Build a map up front.
  const involvedExperimentIds = Array.from(
    new Set(scans.map((s) => s.experiment_id))
  );
  const waveLinks = await db.graviExperimentWaveMetadata.findMany({
    where: { experiment_id: { in: involvedExperimentIds } },
    include: {
      accession: {
        include: {
          graviPlateAccessions: { include: { sections: true } },
        },
      },
    },
  });
  const waveAccessionMap = new Map<
    string,
    (typeof waveLinks)[number]['accession']['graviPlateAccessions']
  >();
  for (const link of waveLinks) {
    waveAccessionMap.set(
      `${link.experiment_id}::${link.wave_number}`,
      link.accession.graviPlateAccessions
    );
  }

  // Group scans by experiment name → wave number
  const experimentWaveMap = new Map<
    string,
    Map<
      number,
      {
        imageIds: string[];
        imagePaths: string[];
        scanRows: ScanRow[];
        plateRows: PlateRow[];
        sectionRows: SectionRow[];
      }
    >
  >();

  for (const scan of scans) {
    const expName = scan.experiment.name;
    if (!experimentWaveMap.has(expName)) {
      experimentWaveMap.set(expName, new Map());
    }

    const waveMap = experimentWaveMap.get(expName)!;
    const waveNum = scan.wave_number;
    if (!waveMap.has(waveNum)) {
      // First scan we see for this (experiment, wave) — also seed plate/section
      // rows from the wave-linked accession so plates.csv + sections.csv get
      // emitted alongside metadata.csv.
      const waveKey = `${scan.experiment_id}::${waveNum}`;
      const platesForWave = waveAccessionMap.get(waveKey) ?? [];
      const plateRows: PlateRow[] = platesForWave.map((p) => ({
        plate_id: p.plate_id,
        accession: p.accession,
        transplant_date: p.transplant_date,
        custom_note: p.custom_note,
      }));
      const sectionRows: SectionRow[] = platesForWave.flatMap((p) =>
        p.sections.map((s) => ({
          plate_id: p.plate_id,
          section_id: s.plate_section_id,
          plant_qr: s.plant_qr,
          medium: s.medium,
        }))
      );
      waveMap.set(waveNum, {
        imageIds: [],
        imagePaths: [],
        scanRows: [],
        plateRows,
        sectionRows,
      });
    }

    // Wave-aware accession lookup: GraviScan experiments use
    // GraviExperimentWaveMetadata, not the legacy Experiment.accession_id.
    // Fall back to the legacy path for cylinderscan-shaped data.
    const wavePlates =
      waveAccessionMap.get(`${scan.experiment_id}::${waveNum}`) ??
      scan.experiment.accession?.graviPlateAccessions ??
      [];
    const matchedAccession = wavePlates.find(
      (pa) => pa.plate_id === scan.plate_barcode
    );
    const accession = matchedAccession?.accession ?? '';

    const entry = waveMap.get(waveNum)!;
    for (const img of scan.images) {
      entry.imageIds.push(img.id);
      entry.imagePaths.push(img.path);
      entry.scanRows.push({
        wave_number: scan.wave_number,
        plate_barcode: scan.plate_barcode,
        plate_index: scan.plate_index,
        grid_mode: scan.grid_mode,
        capture_date: scan.capture_date,
        accession,
        transplant_date: scan.transplant_date,
        custom_note: scan.custom_note,
        image_filename: path.basename(img.path),
      });
    }
  }

  // Count total images for progress tracking
  let totalImages = 0;
  let completedImages = 0;
  let failedImages = 0;
  for (const [, waveMap] of experimentWaveMap) {
    for (const [, data] of waveMap) {
      totalImages += data.imagePaths.length;
    }
  }

  // Process each experiment → wave
  for (const [expName, waveMap] of experimentWaveMap) {
    const sortedWaves = [...waveMap.keys()].sort((a, b) => a - b);

    for (const waveNum of sortedWaves) {
      const data = waveMap.get(waveNum)!;
      const boxDest = systemName
        ? `${BOX_BASE_PATH}/${systemName}/${expName}/wave_${waveNum}`
        : `${BOX_BASE_PATH}/${expName}/wave_${waveNum}`;
      console.log(
        `[BoxBackup] Backing up ${data.imagePaths.length} images for ${expName}/wave_${waveNum}`
      );

      // Copy image files with per-file progress
      const copyResult = await rcloneCopyFiles(data.imagePaths, boxDest, () => {
        completedImages++;
        onProgress?.({
          totalImages,
          completedImages,
          failedImages,
          currentExperiment: expName,
        });
      });

      // Per-file status: mark only files that didn't error as uploaded
      const uploadedIds: string[] = [];
      const failedIds: string[] = [];

      if (!copyResult.success && copyResult.erroredFiles.size === 0) {
        // Total rclone failure (no per-file info) — mark ALL as failed
        console.error(
          `[BoxBackup] rclone failed entirely for ${expName}/wave_${waveNum} — marking all files as failed`
        );
        failedIds.push(...data.imageIds);
      } else {
        for (let i = 0; i < data.imagePaths.length; i++) {
          const filename = path.basename(data.imagePaths[i]);
          if (copyResult.erroredFiles.has(filename)) {
            failedIds.push(data.imageIds[i]);
          } else {
            uploadedIds.push(data.imageIds[i]);
          }
        }
      }

      if (uploadedIds.length > 0) {
        await db.graviImage.updateMany({
          where: { id: { in: uploadedIds } },
          data: { box_status: 'uploaded' },
        });
        result.filesCopied += uploadedIds.length;
      }

      if (failedIds.length > 0) {
        await db.graviImage.updateMany({
          where: { id: { in: failedIds } },
          data: { box_status: 'failed' },
        });
        failedImages += failedIds.length;
        result.errors.push(
          `${expName}/wave_${waveNum}: ${failedIds.length}/${data.imagePaths.length} files failed`
        );
        result.success = false;
        console.error(
          `[BoxBackup] ${failedIds.length} files failed for ${expName}/wave_${waveNum}:`,
          copyResult.error
        );
        // Update progress with failed count
        onProgress?.({
          totalImages,
          completedImages,
          failedImages,
          currentExperiment: expName,
        });
      }

      // Export and copy CSV files per wave. Three separate files so each level
      // (scan, plate, section) can be consumed independently downstream and
      // joined on (experiment, wave_number, plate_id) when needed.
      const csvJobs: Array<{
        rowsLen: number;
        content: string;
        tmpName: string;
        boxName: string;
      }> = [];

      if (data.scanRows.length > 0) {
        csvJobs.push({
          rowsLen: data.scanRows.length,
          content: exportMetadataCSV(expName, data.scanRows),
          tmpName: `graviscan-metadata-${expName}-wave${waveNum}.csv`,
          boxName: 'metadata.csv',
        });
      }
      if (data.plateRows.length > 0) {
        csvJobs.push({
          rowsLen: data.plateRows.length,
          content: exportPlatesCSV(expName, waveNum, data.plateRows),
          tmpName: `graviscan-plates-${expName}-wave${waveNum}.csv`,
          boxName: 'plates.csv',
        });
      }
      if (data.sectionRows.length > 0) {
        csvJobs.push({
          rowsLen: data.sectionRows.length,
          content: exportSectionsCSV(expName, waveNum, data.sectionRows),
          tmpName: `graviscan-sections-${expName}-wave${waveNum}.csv`,
          boxName: 'sections.csv',
        });
      }

      for (const job of csvJobs) {
        const tmpCsvPath = path.join(os.tmpdir(), job.tmpName);
        try {
          fs.writeFileSync(tmpCsvPath, job.content, 'utf-8');
          const csvResult = await rcloneCopyFile(
            tmpCsvPath,
            job.boxName,
            boxDest
          );
          if (!csvResult.success) {
            result.errors.push(
              `${expName}/wave_${waveNum} ${job.boxName}: ${csvResult.error}`
            );
            console.error(
              `[BoxBackup] Failed to copy ${job.boxName} for ${expName}/wave_${waveNum}:`,
              csvResult.error
            );
          } else {
            console.log(
              `[BoxBackup] Uploaded ${job.boxName} (${job.rowsLen} rows) for ${expName}/wave_${waveNum}`
            );
          }
        } finally {
          try {
            fs.unlinkSync(tmpCsvPath);
          } catch {
            // ignore
          }
        }
      }
    }

    result.experiments++;
  }

  console.log(
    `[BoxBackup] Complete: ${result.experiments} experiments, ${result.filesCopied} files` +
      (result.errors.length > 0 ? `, ${result.errors.length} errors` : '')
  );

  return result;
}
