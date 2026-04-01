/**
 * QR Code Reader
 *
 * Reads QR/barcodes from scan images using sharp + @undecaf/zbar-wasm.
 * Runs in the main process (Node.js), no Python dependency needed.
 *
 * Uses a sequential queue to avoid memory spikes from concurrent
 * sharp decodes (same pattern as the image preview handler).
 *
 * Usage:
 *   const codes = await readQrCodes('/path/to/scan.tif');
 *   // ['COL-0_Wave_4_Plate_13_S1_PC22_0.1uM', ...]
 */

import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';

// Sequential queue — prevents concurrent sharp decodes from crashing on Linux
let qrReadQueue: Promise<unknown> = Promise.resolve();

/**
 * Read QR codes from a scan image file.
 *
 * Resizes to 2000px max dimension for faster/reliable QR detection.
 * The original scan image on disk is not modified.
 *
 * @param imagePath - Path to TIFF/PNG/JPEG scan image
 * @returns Array of decoded QR code strings, or empty array if none found/error
 */
export async function readQrCodes(imagePath: string): Promise<string[]> {
  const result = await (qrReadQueue = qrReadQueue.then(async () => {
    try {
      if (!fs.existsSync(imagePath)) {
        console.warn(`[QR Reader] Image not found: ${imagePath}`);
        return [];
      }

      // Load and resize image using sharp
      const { data, info } = await sharp(imagePath)
        .resize(2000, null, { withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Import zbar-wasm dynamically (ESM module)
      const { scanImageData } = await import('@undecaf/zbar-wasm');

      // Create ImageData-like object for zbar
      const imageData = {
        data: new Uint8ClampedArray(data),
        width: info.width,
        height: info.height,
        colorSpace: 'srgb' as PredefinedColorSpace,
      };

      const symbols = await scanImageData(imageData as ImageData);
      const codes = symbols.map((s) => s.decode());

      console.log(
        `[QR Reader] ${codes.length} code(s) from ${path.basename(imagePath)}`
      );

      return codes;
    } catch (error) {
      console.error(
        `[QR Reader] Error reading ${path.basename(imagePath)}:`,
        error instanceof Error ? error.message : error
      );
      return [];
    }
  }));

  return result as string[];
}
