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
import { ensureSymlinkOrCopy } from './fs-symlink-or-copy';

const RCLONE_REMOTE = 'Box';
const BOX_BASE_PATH = 'GraviScan-Backups';

/**
 * Escape a value for inclusion in a CSV field.
 * Wraps in double-quotes and escapes inner quotes when the value
 * contains commas, double-quotes, or newlines. Also neutralizes CSV/
 * formula injection: this file is uploaded to Box for humans to open in
 * Excel/Sheets, which treats a leading =, +, -, or @ as a formula —
 * prefixing with a single quote forces it to be read as literal text.
 */
export function csvEscape(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
    return '"' + safe.replace(/"/g, '""') + '"';
  }
  return safe;
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
export function rcloneCopyFiles(
  filePaths: string[],
  boxDestination: string,
  onFileComplete?: (filename: string) => void
): Promise<{
  success: boolean;
  erroredFiles: Set<string>;
  error?: string;
  resolvedNames: Map<string, string>;
}> {
  return new Promise((resolve) => {
    // Create a temp directory with symlinks to the files we want to copy
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graviscan-backup-'));

    // resolveGraviScanPath exists because the DB can store a stale path
    // (e.g. missing the _et_ timestamp inserted after a rename, or the
    // wrong extension) — the file rclone actually copies and logs uses
    // the RESOLVED basename, which can differ from the original DB
    // path's basename. Keyed by the ORIGINAL FULL PATH, not the original
    // basename: two different images in the same wave can share a
    // basename (different source directories, or genuine duplicate DB
    // rows) while being distinct, unique-by-full-path files — keying by
    // basename would let one image's resolution/error silently overwrite
    // and misattribute onto a completely different image's row. The
    // RESOLVED side is still keyed by basename since that's the actual
    // physical filename rclone operates on in tmpDir; two different
    // original paths resolving to the same physical file is a separate,
    // narrower, already-documented edge case (see resolvedToOriginalName
    // below), not the one this keying change addresses.
    // Declared before the try block (not just before use) so the catch
    // block below can still return whatever was resolved before an
    // exception, instead of unconditionally discarding it.
    const resolvedToOriginalName = new Map<string, string>();
    // Inverse of resolvedToOriginalName, keyed by original full path —
    // returned to the caller so it can build metadata.csv using the
    // SAME resolved name this call determined, instead of resolving
    // the path a second time itself. Two independent resolutions of
    // the same path can legitimately disagree if disk state changes
    // between them (e.g. a rename completing in between) — resolving
    // once, here, and threading the result through the return value
    // closes that gap rather than merely narrowing it.
    const originalToResolvedName = new Map<string, string>();
    const missingFilePaths = new Set<string>();

    try {
      let symlinksCreated = 0;
      const missingFiles: string[] = [];
      for (const filePath of filePaths) {
        const resolvedPath = resolveGraviScanPath(filePath);
        if (resolvedPath) {
          const fileName = path.basename(resolvedPath);
          resolvedToOriginalName.set(fileName, filePath);
          originalToResolvedName.set(filePath, fileName);
          const linkPath = path.join(tmpDir, fileName);
          // Windows restricts unprivileged symlink creation (requires
          // admin or Developer Mode — the default state on most lab
          // machines), and this path was never exercised by CI (rclone
          // itself isn't installed on any CI runner), so a raw
          // fs.symlinkSync() call here would go undetected until it broke
          // Box backup entirely on real hardware.
          ensureSymlinkOrCopy(resolvedPath, linkPath, 'file');
          symlinksCreated++;
        } else {
          missingFiles.push(filePath);
          missingFilePaths.add(filePath);
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
          erroredFiles: missingFilePaths,
          error: `None of the ${filePaths.length} image files exist on disk`,
          resolvedNames: originalToResolvedName,
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

      const erroredFiles = new Set<string>(missingFilePaths);
      // Captures the raw message from the FIRST unattributed level:"error"
      // line — a wave-level/global failure (auth expiry, quota exceeded,
      // backend outage) rather than a specific file's error. Surfaced to
      // the operator instead of a generic "rclone exited with code N",
      // which gives no way to tell "retry will fix this" apart from
      // "re-authenticate rclone first." First, not last: other in-flight
      // transfers typically log their own generic "context canceled"
      // errors as the process unwinds after the real failure.
      let waveLevelErrorMsg: string | undefined;
      let stderrBuffer = '';
      const processLine = (line: string) => {
        if (!line.trim()) return;
        try {
          const entry = JSON.parse(line);
          if (entry.level === 'error' && entry.msg) {
            const token = entry.msg.split(':')[0].trim();
            // Only trustworthy as a PER-FILE error if the extracted
            // token actually resolves to one of this call's own files
            // (by its resolved, on-disk name — see
            // resolvedToOriginalName above). rclone also logs
            // global/config failures at level:"error" with no per-file
            // attribution (e.g. "Failed to copy: googleapi: Error
            // 401..."); blindly trusting that token as a filename would
            // leave every real file unmatched, causing the caller to
            // treat all of them as successfully uploaded — silent,
            // permanent data loss reported as success.
            const originalName = token
              ? resolvedToOriginalName.get(token)
              : undefined;
            if (originalName) {
              erroredFiles.add(originalName);
            } else {
              // First wins, not last: once one fatal error kills the
              // rclone process, other in-flight transfers typically log
              // their own generic "context canceled"-style errors as
              // they unwind. Overwriting keeps replacing the actual
              // root-cause diagnostic (e.g. a credentials/quota error)
              // with one of those unhelpful follow-on messages.
              waveLevelErrorMsg ??= entry.msg;
            }
          } else if (
            entry.level === 'info' &&
            entry.msg &&
            /: Copied \(/.test(entry.msg)
          ) {
            const token = entry.msg.split(':')[0].trim();
            const originalName = token
              ? resolvedToOriginalName.get(token)
              : undefined;
            if (originalName) onFileComplete?.(originalName);
          }
        } catch {
          // skip non-JSON lines
        }
      };
      proc.stderr.on('data', (data: Buffer) => {
        stderrBuffer += data.toString();
        // Parse complete lines as they stream in
        const lines = stderrBuffer.split('\n');
        stderrBuffer = lines.pop() || ''; // keep incomplete last line in buffer
        for (const line of lines) processLine(line);
      });

      proc.on('close', (code) => {
        // Parse any remaining buffered line
        if (stderrBuffer.trim()) processLine(stderrBuffer);

        // Clean up temp dir
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors
        }

        if (code === 0 && erroredFiles.size === 0) {
          resolve({
            success: true,
            erroredFiles,
            resolvedNames: originalToResolvedName,
          });
        } else {
          resolve({
            success: false,
            erroredFiles,
            error:
              code !== 0
                ? (waveLevelErrorMsg ?? `rclone exited with code ${code}`)
                : undefined,
            resolvedNames: originalToResolvedName,
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
          resolvedNames: originalToResolvedName,
        });
      });
    } catch (err) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      // Reuses whatever resolvedToOriginalName/missingFilePaths already
      // accumulated before the exception (both declared above the try
      // block specifically for this) rather than discarding it — an
      // exception partway through the resolution loop (e.g.
      // ensureSymlinkOrCopy failing on a full disk) shouldn't forget
      // about files that resolved fine earlier in the same loop.
      resolve({
        success: false,
        erroredFiles: missingFilePaths,
        resolvedNames: originalToResolvedName,
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

  // BOM prefix for Excel UTF-8 auto-detection on Windows
  return '\uFEFF' + rows.join('\n') + '\n';
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
        // Placeholder — overwritten with the RESOLVED on-disk basename
        // once rcloneCopyFiles runs for this wave (see the
        // resolvedNames-based patch loop below), or the row is dropped
        // entirely if the file can't be found at all. Resolving here
        // too (this loop runs for every wave up front, long before that
        // wave's own rcloneCopyFiles call) would mean two independent
        // filesystem reads of the same path at two different times,
        // which can disagree if disk state changes in between (e.g. a
        // rename completing) — resolving once, at actual-upload time,
        // and threading the result back avoids that gap entirely rather
        // than merely narrowing it.
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
    const safeName = expName.replace(/[/\\:*?"<>|.]/g, '_');
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
      let waveCompletedImages = 0;
      const copyResult = await rcloneCopyFiles(data.imagePaths, boxDest, () => {
        completedImages++;
        waveCompletedImages++;
        onProgress?.({
          totalImages,
          completedImages,
          failedImages,
          currentExperiment: expName,
        });
      });

      // Per-file status: mark only files that didn't error as uploaded.
      // exportableScanRowIndexes is built in lockstep with this — a row
      // belongs in metadata.csv if and only if its image is actually
      // confirmed uploaded, not merely "found on disk" (resolvedNames
      // only proves resolution succeeded; a resolved file can still hit
      // a genuine per-file rclone transfer error and land in
      // erroredFiles). Computing both from the same loop, keyed by the
      // same full original path, is what keeps them from silently
      // diverging or cross-contaminating on a basename collision the
      // way an earlier version of this fix did.
      const uploadedIds: string[] = [];
      const failedIds: string[] = [];
      const exportableScanRowIndexes = new Set<number>();

      if (
        !copyResult.success &&
        (copyResult.erroredFiles.size === 0 || copyResult.error !== undefined)
      ) {
        // Total rclone failure — mark ALL as failed, including any that
        // logged a per-file "Copied" line (and so already incremented
        // completedImages) before the process died. A non-zero exit
        // means rclone didn't run to completion, so any file NOT in
        // erroredFiles is indistinguishable from "silently skipped
        // because already present at the destination" vs. "never
        // attempted because rclone crashed" — treat the whole wave
        // conservatively as needing retry rather than inferring success
        // for anything not explicitly matched. Without the `error !==
        // undefined` half of this condition, a wave with one
        // genuinely-matched per-file error AND a crash/quota/auth
        // failure partway through would still mark every OTHER
        // (never-attempted) file as uploaded — the same silent-data-loss
        // defect this whole check exists to prevent, reached via a
        // different door (a non-empty erroredFiles no longer implies
        // "every other file is confirmed fine"). None of this wave's
        // images are confirmed uploaded, so exportableScanRowIndexes
        // stays empty — metadata.csv is skipped below rather than
        // describing a wave that wasn't actually backed up.
        console.error(
          `[BoxBackup] rclone failed entirely for ${expName}/wave_${waveNum} — marking all files as failed`
        );
        failedIds.push(...data.imageIds);
        completedImages -= waveCompletedImages;
      } else {
        for (let i = 0; i < data.imagePaths.length; i++) {
          const filePath = data.imagePaths[i];
          if (copyResult.erroredFiles.has(filePath)) {
            failedIds.push(data.imageIds[i]);
          } else {
            uploadedIds.push(data.imageIds[i]);
            const resolvedBasename = copyResult.resolvedNames.get(filePath);
            if (resolvedBasename) {
              data.scanRows[i].image_filename = resolvedBasename;
              exportableScanRowIndexes.add(i);
            }
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
          `${expName}/wave_${waveNum}: ${failedIds.length}/${data.imagePaths.length} files failed` +
            (copyResult.error ? ` (${copyResult.error})` : '')
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

      // Export and copy metadata CSV per wave — excluding rows for
      // images that were never found on disk (see
      // exportableScanRowIndexes above).
      const exportableScanRows = data.scanRows.filter((_, i) =>
        exportableScanRowIndexes.has(i)
      );
      if (exportableScanRows.length > 0) {
        const csvContent = exportMetadataCSV(expName, exportableScanRows);
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
            result.success = false;
            console.error(
              `[BoxBackup] Failed to copy metadata for ${expName}/wave_${waveNum}:`,
              csvResult.error
            );
            // There is no separate per-wave CSV-status field — the next
            // run's scan-selection query only looks at image box_status.
            // Leaving these images at 'uploaded' would silently exclude
            // this wave from every future run, permanently losing
            // metadata.csv with no further indication anything is wrong.
            // Revert them to 'failed' so the wave (images + CSV) is
            // retried next time, even though the images themselves already
            // copied successfully (rclone skips files already present at
            // the destination, so the re-copy on retry is a cheap
            // existence check, not a full re-transfer).
            if (uploadedIds.length > 0) {
              await db.graviImage.updateMany({
                where: { id: { in: uploadedIds } },
                data: { box_status: 'failed' },
              });
              // These images are no longer durably backed up as far as
              // this run's summary is concerned — they were counted above
              // before the CSV attempt, but the persisted box_status now
              // says they still need a retry. Undo that count so the
              // operator-facing "N uploaded" message doesn't overstate
              // what's actually in Box.
              result.filesCopied -= uploadedIds.length;
              // The live per-callback counters have the identical defect:
              // completedImages was incremented (and broadcast via
              // onProgress) as each file copied, before the CSV attempt.
              // Correct and re-emit so the global upload banner and each
              // experiment row's "Box N/M" indicator don't keep showing a
              // stale, now-inaccurate "fully completed" count.
              completedImages -= uploadedIds.length;
              failedImages += uploadedIds.length;
              onProgress?.({
                totalImages,
                completedImages,
                failedImages,
                currentExperiment: expName,
              });
            }
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
