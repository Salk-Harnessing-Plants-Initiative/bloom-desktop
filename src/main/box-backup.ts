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
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveGraviScanPath } from './graviscan-path-utils';

const RCLONE_REMOTE = 'Box';
const BOX_BASE_PATH = 'GraviScan-Backups';

/**
 * Escape a value for inclusion in a CSV field.
 * Wraps in double-quotes and escapes inner quotes when the value
 * contains commas, double-quotes, or newlines.
 */
function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

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
    const child = spawn('rclone', ['version'], { stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
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

/**
 * Export metadata CSV with scan-level data (wave_number from GraviScan).
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
        csvEscape(experimentName),
        csvEscape(String(r.wave_number)),
        csvEscape(r.plate_barcode ?? ''),
        csvEscape(r.plate_index),
        csvEscape(r.grid_mode),
        csvEscape(r.capture_date.toISOString()),
        csvEscape(r.accession),
        csvEscape(
          r.transplant_date ? r.transplant_date.toISOString().split('T')[0] : ''
        ),
        csvEscape(r.custom_note ?? ''),
        csvEscape(r.image_filename),
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

  // Group scans by experiment name → wave number
  const experimentWaveMap = new Map<
    string,
    Map<
      number,
      { imageIds: string[]; imagePaths: string[]; scanRows: ScanRow[] }
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
      waveMap.set(waveNum, { imageIds: [], imagePaths: [], scanRows: [] });
    }

    // Look up accession from plate accessions if available
    const plateAccessions =
      scan.experiment.accession?.graviPlateAccessions ?? [];
    const matchedAccession = plateAccessions.find(
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
    const safeName = expName.replace(/[/\\:*?"<>|.]/g, '_').replace(/\.\./g, '_');
    const sortedWaves = [...waveMap.keys()].sort((a, b) => a - b);

    for (const waveNum of sortedWaves) {
      const data = waveMap.get(waveNum)!;
      const boxDest = systemName
        ? `${BOX_BASE_PATH}/${systemName}/${safeName}/wave_${waveNum}`
        : `${BOX_BASE_PATH}/${safeName}/wave_${waveNum}`;
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

      // Export and copy metadata CSV per wave
      if (data.scanRows.length > 0) {
        const csvContent = exportMetadataCSV(expName, data.scanRows);
        const tmpCsvPath = path.join(
          os.tmpdir(),
          `graviscan-metadata-${safeName}-wave${waveNum}.csv`
        );

        try {
          fs.writeFileSync(tmpCsvPath, csvContent, 'utf-8');
          const csvResult = await rcloneCopyFile(
            tmpCsvPath,
            'metadata.csv',
            boxDest
          );
          if (!csvResult.success) {
            result.errors.push(
              `${expName}/wave_${waveNum} metadata: ${csvResult.error}`
            );
            console.error(
              `[BoxBackup] Failed to copy metadata for ${expName}/wave_${waveNum}:`,
              csvResult.error
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
