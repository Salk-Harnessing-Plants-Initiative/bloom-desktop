/**
 * GraviScan Image Handlers
 *
 * Extracted from Ben's monolithic graviscan-handlers.ts.
 * Handles image operations: output directory, reading scan images,
 * cloud upload (Box backup), and downloading experiment images.
 *
 * Progress events are delivered via callback injection rather than
 * direct mainWindow.webContents.send() calls, keeping this module
 * decoupled from Electron IPC plumbing.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { app } from 'electron';
import { PrismaClient } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';
import sharp from 'sharp';
import { resolveGraviScanPath } from '../graviscan-path-utils';
import { runBoxBackup } from '../box-backup';
import { uploadAllPendingScans } from '../graviscan-upload';
import { getGraviscanOutputDir } from '../graviscan-output-dir';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THUMBNAIL_QUALITY = 85;
const FULL_QUALITY = 95;
const THUMBNAIL_WIDTH = 400;
const COPY_CONCURRENCY = 4;

// ---------------------------------------------------------------------------
// CSV escaping helper
// ---------------------------------------------------------------------------

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

// ---------------------------------------------------------------------------
// Upload concurrency guard
// ---------------------------------------------------------------------------

let uploadInProgress = false;

/** Reset the upload-in-progress flag (for testing). */
export function resetUploadState(): void {
  uploadInProgress = false;
}

// ---------------------------------------------------------------------------
// Sequential image-decode queue
// ---------------------------------------------------------------------------

// Concurrent sharp/libvips decodes crash with GLib threading errors on
// Linux. Queue all readScanImage() work onto this chain so decodes run
// strictly sequentially.
let imageLoadQueue: Promise<unknown> = Promise.resolve();

// ---------------------------------------------------------------------------
// getOutputDir
// ---------------------------------------------------------------------------

/**
 * Get the scan output directory path.
 * Development: .graviscan/ in project root
 * Production: GRAVISCAN_OUTPUT_DIR from ~/.bloom/.env if set, otherwise
 * ~/.bloom/graviscan/
 */
export function getOutputDir(): {
  success: boolean;
  path?: string;
  error?: string;
} {
  try {
    const homeDir = app.getPath('home');
    const outputDir = getGraviscanOutputDir({
      envPath: path.join(homeDir, '.bloom', '.env'),
      homeDir,
      appPath: app.getAppPath(),
      isDev: process.env.NODE_ENV === 'development',
    });

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log('[GraviScan] Created output directory:', outputDir);
    }

    return { success: true, path: outputDir };
  } catch (error) {
    console.error('[GraviScan] Error getting output directory:', error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to get output directory',
    };
  }
}

// ---------------------------------------------------------------------------
// readScanImage
// ---------------------------------------------------------------------------

/**
 * Read a scan image file and return as base64 data URI.
 * Converts TIFF to JPEG. Thumbnail: quality 85, 400px resize.
 * Full: quality 95, no resize.
 *
 * Queued via `imageLoadQueue` so concurrent calls decode strictly
 * sequentially — concurrent sharp/libvips decodes crash with GLib
 * threading errors on Linux.
 */
export async function readScanImage(
  filePath: string,
  options?: { full?: boolean }
): Promise<{ success: boolean; dataUri?: string; error?: string }> {
  const decode = async (): Promise<{
    success: boolean;
    dataUri?: string;
    error?: string;
  }> => {
    try {
      const resolvedPath = resolveGraviScanPath(filePath);
      if (!resolvedPath) {
        console.log(
          `[read-scan-image] File not found: ${filePath} (tried extensions + _et_ fallback)`
        );
        return { success: false, error: 'File not found' };
      }
      if (resolvedPath !== filePath) {
        console.log(
          `[read-scan-image] Resolved: ${path.basename(filePath)} -> ${path.basename(resolvedPath)}`
        );
        filePath = resolvedPath;
      }

      const quality = options?.full ? FULL_QUALITY : THUMBNAIL_QUALITY;
      const pipeline = sharp(filePath);
      if (!options?.full) {
        pipeline.resize(THUMBNAIL_WIDTH, null, { withoutEnlargement: true });
      }
      const jpegBuffer = await pipeline.jpeg({ quality }).toBuffer();
      const base64 = jpegBuffer.toString('base64');

      return {
        success: true,
        dataUri: `data:image/jpeg;base64,${base64}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read image',
      };
    }
  };

  const result = imageLoadQueue.then(decode);
  imageLoadQueue = result;
  return result;
}

// ---------------------------------------------------------------------------
// uploadAllScans
// ---------------------------------------------------------------------------

/**
 * Upload all pending/failed scans to Bloom (Supabase) and Box (rclone).
 * Both run in parallel via Promise.allSettled; their results are merged.
 * A thrown/rejected branch becomes a synthesized failed result rather than
 * aborting the other branch or the whole function — Bloom failing doesn't
 * prevent Box from completing, and vice versa.
 * Progress events from both targets are delivered via the single onProgress
 * callback (the IPC layer forwards it to the 'graviscan:upload-progress'
 * channel; it does not distinguish source, matching the existing wiring).
 */
export async function uploadAllScans(
  db: PrismaClient,
  onProgress?: (progress: unknown) => void
): Promise<{
  success: boolean;
  uploaded: number;
  skipped: number;
  failed: number;
  errors: string[];
  /**
   * Whether the installed @salk-hpi/bloom-js supports Bloom session/plate-
   * metadata linking (see graviscan-upload.ts's UploadResult). Surfaced here
   * so a future renderer can show operators when metadata linking isn't
   * active, rather than that only being visible in main-process logs.
   */
  metadataLinkingAvailable: boolean;
}> {
  if (uploadInProgress) {
    console.log('[GraviScan:UPLOAD] Upload already in progress — skipping');
    return {
      success: false,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      errors: ['Upload already in progress'],
      metadataLinkingAvailable: false,
    };
  }
  uploadInProgress = true;
  try {
    console.log('[GraviScan:UPLOAD] Starting Bloom + Box upload in parallel');

    const [bloomSettled, boxSettled] = await Promise.allSettled([
      uploadAllPendingScans(db, (progress) => {
        onProgress?.(progress);
      }),
      runBoxBackup(db, (progress) => {
        onProgress?.(progress);
      }),
    ]);

    const bloomResult =
      bloomSettled.status === 'fulfilled'
        ? bloomSettled.value
        : {
            success: false,
            uploaded: 0,
            skipped: 0,
            failed: 0,
            errors: [
              `Bloom upload threw: ${
                bloomSettled.reason instanceof Error
                  ? bloomSettled.reason.message
                  : String(bloomSettled.reason)
              }`,
            ],
            metadataLinkingAvailable: false,
          };

    const boxResult =
      boxSettled.status === 'fulfilled'
        ? boxSettled.value
        : {
            success: false,
            experiments: 0,
            filesCopied: 0,
            errors: [
              `Box backup threw: ${
                boxSettled.reason instanceof Error
                  ? boxSettled.reason.message
                  : String(boxSettled.reason)
              }`,
            ],
          };

    console.log('[GraviScan:UPLOAD] Bloom result:', bloomResult);
    console.log('[GraviScan:UPLOAD] Box result:', boxResult);

    return {
      success: bloomResult.success && boxResult.success,
      uploaded: bloomResult.uploaded + boxResult.filesCopied,
      skipped: bloomResult.skipped,
      failed: bloomResult.failed + boxResult.errors.length,
      errors: [...bloomResult.errors, ...boxResult.errors],
      metadataLinkingAvailable: bloomResult.metadataLinkingAvailable,
    };
  } catch (error) {
    console.error('[GraviScan:UPLOAD] Error:', error);
    return {
      success: false,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      errors: [error instanceof Error ? error.message : 'Upload failed'],
      metadataLinkingAvailable: false,
    };
  } finally {
    uploadInProgress = false;
  }
}

// ---------------------------------------------------------------------------
// downloadImages
// ---------------------------------------------------------------------------

/**
 * Download experiment images to a target directory.
 * Dialog handling is deferred to the IPC registration layer (3c).
 * Progress events delivered via onProgress callback.
 * Copies files with 4-way concurrency.
 */
export async function downloadImages(
  db: PrismaClient,
  params: {
    experimentId: string;
    experimentName: string;
    targetDir?: string;
    waveNumber?: number;
  },
  onProgress?: (progress: {
    total: number;
    completed: number;
    currentFile: string;
  }) => void
): Promise<{
  success: boolean;
  total: number;
  copied: number;
  errors: string[];
}> {
  try {
    // No explicit targetDir ⇒ default to the user's Downloads folder, so a
    // future renderer can omit it entirely (matching production's simpler
    // one-click-download contract). An explicit targetDir always wins.
    const targetDir = params.targetDir ?? app.getPath('downloads');

    const scans = await (db as any).graviScan.findMany({
      where: {
        experiment_id: params.experimentId,
        deleted: false,
        ...(params.waveNumber !== undefined && {
          wave_number: params.waveNumber,
        }),
      },
      include: {
        images: true,
        experiment: {
          include: {
            accession: {
              include: {
                graviPlateAccessions: { include: { sections: true } },
              },
            },
          },
        },
      },
      orderBy: [
        { wave_number: 'asc' },
        { capture_date: 'asc' },
        { plate_index: 'asc' },
      ],
    });

    // Sanitize experiment name for safe use as directory name
    const safeName = params.experimentName.replace(/[/\\:*?"<>|.]/g, '_');
    const expDir = path.join(targetDir, safeName);

    // Group scans by wave number for subfolder organization
    const waveGroups = new Map<number, typeof scans>();
    for (const scan of scans) {
      const wave = scan.wave_number;
      if (!waveGroups.has(wave)) waveGroups.set(wave, []);
      waveGroups.get(wave)!.push(scan);
    }

    const csvHeader =
      'experiment,wave_number,plate_barcode,plate_index,grid_mode,capture_date,accession,transplant_date,custom_note,image_filename';
    const platesHeader =
      'experiment,wave_number,plate_id,accession,transplant_date,custom_note';
    const sectionsHeader =
      'experiment,wave_number,plate_id,section_id,plant_qr,medium';
    const filesToCopy: { src: string; dest: string }[] = [];

    for (const [waveNum, waveScans] of waveGroups) {
      const waveDir = path.join(expDir, `wave_${waveNum}`);
      fs.mkdirSync(waveDir, { recursive: true });

      // Same-experiment legacy accession link, shared by every scan in this
      // wave (wave-aware GraviExperimentWaveMetadata lookup is deferred —
      // see proposal's "Out of scope").
      const wavePlates: any[] =
        waveScans[0]?.experiment.accession?.graviPlateAccessions ?? [];

      const csvRows: string[] = [csvHeader];
      const platesRows: string[] = [platesHeader];
      const sectionsRows: string[] = [sectionsHeader];

      for (const plate of wavePlates) {
        platesRows.push(
          [
            csvEscape(params.experimentName),
            csvEscape(String(waveNum)),
            csvEscape(plate.plate_id),
            csvEscape(plate.accession),
            csvEscape(
              plate.transplant_date
                ? plate.transplant_date.toISOString().split('T')[0]
                : ''
            ),
            csvEscape(plate.custom_note ?? ''),
          ].join(',')
        );

        for (const section of plate.sections ?? []) {
          sectionsRows.push(
            [
              csvEscape(params.experimentName),
              csvEscape(String(waveNum)),
              csvEscape(plate.plate_id),
              csvEscape(section.plate_section_id),
              csvEscape(section.plant_qr),
              csvEscape(section.medium ?? ''),
            ].join(',')
          );
        }
      }

      for (const scan of waveScans) {
        const matchedPlate = wavePlates.find(
          (p: any) => p.plate_id === scan.plate_barcode
        );
        const accession = matchedPlate?.accession ?? '';

        for (const img of scan.images) {
          const srcPath = resolveGraviScanPath(img.path);
          if (!srcPath) continue;

          const originalFilename = path.basename(srcPath);
          filesToCopy.push({
            src: srcPath,
            dest: path.join(waveDir, originalFilename),
          });

          csvRows.push(
            [
              csvEscape(params.experimentName),
              csvEscape(String(scan.wave_number)),
              csvEscape(scan.plate_barcode ?? ''),
              csvEscape(String(scan.plate_index)),
              csvEscape(scan.grid_mode),
              csvEscape(scan.capture_date.toISOString()),
              csvEscape(accession),
              csvEscape(
                (scan as any).transplant_date
                  ? (scan as any).transplant_date.toISOString().split('T')[0]
                  : ''
              ),
              csvEscape((scan as any).custom_note ?? ''),
              csvEscape(originalFilename),
            ].join(',')
          );
        }
      }

      // Write the three CSVs per wave subfolder. plates.csv/sections.csv are
      // only emitted when there's data beyond the header row, so analysts
      // don't get empty files (matches production's behavior).
      fs.writeFileSync(
        path.join(waveDir, 'metadata.csv'),
        '\uFEFF' + csvRows.join('\n') + '\n',
        'utf-8'
      );
      if (platesRows.length > 1) {
        fs.writeFileSync(
          path.join(waveDir, 'plates.csv'),
          '\uFEFF' + platesRows.join('\n') + '\n',
          'utf-8'
        );
      }
      if (sectionsRows.length > 1) {
        fs.writeFileSync(
          path.join(waveDir, 'sections.csv'),
          '\uFEFF' + sectionsRows.join('\n') + '\n',
          'utf-8'
        );
      }
    }

    // Copy files with progress (async, 4 concurrent copies)
    let copied = 0;
    const errors: string[] = [];
    let nextIdx = 0;

    const copyNext = async (): Promise<void> => {
      const idx = nextIdx++;
      if (idx >= filesToCopy.length) return;
      const file = filesToCopy[idx];
      try {
        await fs.promises.copyFile(file.src, file.dest);
        copied++;
        onProgress?.({
          total: filesToCopy.length,
          completed: copied,
          currentFile: path.basename(file.dest),
        });
      } catch (err) {
        errors.push(
          `${path.basename(file.src)}: ${err instanceof Error ? err.message : 'Copy failed'}`
        );
      }
      return copyNext();
    };

    await Promise.all(
      Array.from(
        { length: Math.min(COPY_CONCURRENCY, filesToCopy.length) },
        () => copyNext()
      )
    );

    const waveLabel =
      params.waveNumber !== undefined ? ` (wave ${params.waveNumber})` : '';
    console.log(
      `[GraviScan:DOWNLOAD] Copied ${copied}/${filesToCopy.length} images${waveLabel} to ${expDir}`
    );
    return {
      success: errors.length === 0,
      total: filesToCopy.length,
      copied,
      errors,
    };
  } catch (error) {
    console.error('[GraviScan:DOWNLOAD] Error:', error);
    return {
      success: false,
      total: 0,
      copied: 0,
      errors: [error instanceof Error ? error.message : 'Download failed'],
    };
  }
}
