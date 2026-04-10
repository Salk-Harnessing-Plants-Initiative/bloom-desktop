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

import { app } from 'electron';
import { PrismaClient } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';
import sharp from 'sharp';
import { resolveGraviScanPath } from '../graviscan-path-utils';
import { runBoxBackup } from '../box-backup';

// ---------------------------------------------------------------------------
// Upload concurrency guard
// ---------------------------------------------------------------------------

let uploadInProgress = false;

/** Reset the upload-in-progress flag (for testing). */
export function resetUploadState(): void {
  uploadInProgress = false;
}

// ---------------------------------------------------------------------------
// getOutputDir
// ---------------------------------------------------------------------------

/**
 * Get the scan output directory path.
 * Development: .graviscan/ in project root
 * Production: ~/.bloom/graviscan/
 */
export function getOutputDir(): {
  success: boolean;
  path?: string;
  error?: string;
} {
  try {
    const isDev = process.env.NODE_ENV === 'development';
    let outputDir: string;

    if (isDev) {
      outputDir = path.join(app.getAppPath(), '.graviscan');
    } else {
      const homeDir = app.getPath('home');
      outputDir = path.join(homeDir, '.bloom', 'graviscan');
    }

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
 */
export async function readScanImage(
  filePath: string,
  options?: { full?: boolean },
): Promise<{ success: boolean; dataUri?: string; error?: string }> {
  try {
    const resolvedPath = resolveGraviScanPath(filePath);
    if (!resolvedPath) {
      console.log(
        `[read-scan-image] File not found: ${filePath} (tried extensions + _et_ fallback)`,
      );
      return { success: false, error: 'File not found' };
    }
    if (resolvedPath !== filePath) {
      console.log(
        `[read-scan-image] Resolved: ${path.basename(filePath)} -> ${path.basename(resolvedPath)}`,
      );
      filePath = resolvedPath;
    }

    const quality = options?.full ? 95 : 85;
    const pipeline = sharp(filePath);
    if (!options?.full) {
      pipeline.resize(400, null, { withoutEnlargement: true });
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
}

// ---------------------------------------------------------------------------
// uploadAllScans
// ---------------------------------------------------------------------------

/**
 * Upload all pending/failed scans to Box backup.
 * Bloom (Supabase) upload is temporarily disabled due to proxy size limit.
 * Progress events delivered via onProgress callback.
 */
export async function uploadAllScans(
  db: PrismaClient,
  onProgress?: (progress: unknown) => void,
): Promise<{
  success: boolean;
  uploaded: number;
  skipped: number;
  failed: number;
  errors: string[];
}> {
  if (uploadInProgress) {
    console.log('[GraviScan:UPLOAD] Upload already in progress — skipping');
    return {
      success: false,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      errors: ['Upload already in progress'],
    };
  }
  uploadInProgress = true;
  try {
    console.log(
      '[GraviScan:UPLOAD] Bloom upload disabled (proxy size limit) — Box backup only',
    );

    const boxResult = await runBoxBackup(db, (progress) => {
      onProgress?.(progress);
    });

    console.log('[GraviScan:UPLOAD] Box backup result:', boxResult);

    return {
      success: boxResult.success,
      uploaded: boxResult.filesCopied,
      skipped: 0,
      failed: boxResult.errors.length,
      errors: boxResult.errors,
    };
  } catch (error) {
    console.error('[GraviScan:UPLOAD] Error:', error);
    return {
      success: false,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      errors: [error instanceof Error ? error.message : 'Upload failed'],
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
    targetDir: string;
    waveNumber?: number;
  },
  onProgress?: (progress: {
    total: number;
    completed: number;
    currentFile: string;
  }) => void,
): Promise<{
  success: boolean;
  total: number;
  copied: number;
  errors: string[];
}> {
  try {
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
              include: { graviPlateAccessions: true },
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

    const expDir = path.join(params.targetDir, params.experimentName);

    // Group scans by wave number for subfolder organization
    const waveGroups = new Map<number, typeof scans>();
    for (const scan of scans) {
      const wave = scan.wave_number;
      if (!waveGroups.has(wave)) waveGroups.set(wave, []);
      waveGroups.get(wave)!.push(scan);
    }

    const csvHeader =
      'experiment,wave_number,plate_barcode,plate_index,grid_mode,capture_date,accession,transplant_date,custom_note,image_filename';
    const filesToCopy: { src: string; dest: string }[] = [];

    for (const [waveNum, waveScans] of waveGroups) {
      const waveDir = path.join(expDir, `wave_${waveNum}`);
      fs.mkdirSync(waveDir, { recursive: true });

      const csvRows: string[] = [csvHeader];

      for (const scan of waveScans) {
        const plateAccessions =
          scan.experiment.accession?.graviPlateAccessions ?? [];
        const matchedPlate = plateAccessions.find(
          (p: any) => p.plate_id === scan.plate_barcode,
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
              params.experimentName,
              scan.wave_number,
              scan.plate_barcode ?? '',
              scan.plate_index,
              scan.grid_mode,
              scan.capture_date.toISOString(),
              accession,
              (scan as any).transplant_date
                ? (scan as any).transplant_date.toISOString().split('T')[0]
                : '',
              (scan as any).custom_note ?? '',
              originalFilename,
            ].join(','),
          );
        }
      }

      // Write metadata.csv per wave subfolder
      fs.writeFileSync(
        path.join(waveDir, 'metadata.csv'),
        csvRows.join('\n') + '\n',
        'utf-8',
      );
    }

    // Copy files with progress (async, 4 concurrent copies)
    let copied = 0;
    const errors: string[] = [];
    const COPY_CONCURRENCY = 4;
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
          `${path.basename(file.src)}: ${err instanceof Error ? err.message : 'Copy failed'}`,
        );
      }
      return copyNext();
    };

    await Promise.all(
      Array.from(
        { length: Math.min(COPY_CONCURRENCY, filesToCopy.length) },
        () => copyNext(),
      ),
    );

    const waveLabel =
      params.waveNumber !== undefined ? ` (wave ${params.waveNumber})` : '';
    console.log(
      `[GraviScan:DOWNLOAD] Copied ${copied}/${filesToCopy.length} images${waveLabel} to ${expDir}`,
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
