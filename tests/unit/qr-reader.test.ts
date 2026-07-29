/**
 * QR Reader Unit Tests
 *
 * Tests QR code reading from scan images using @undecaf/zbar-wasm.
 * Uses real TIFF fixture images from tests/fixtures/graviscan-qr-images/
 * (not committed — download separately, ~61MB each).
 *
 * Run: npx vitest run tests/unit/qr-reader.test.ts
 *
 * Note: production's version of this file also included a "Verification
 * Logic" describe block that re-implemented the verify-plates
 * classification/swap-detection rules inline against plain object fixtures
 * (no call into real exported code). That's a logic-mirror reimplementation,
 * which this repo's established testing convention avoids — equivalent
 * coverage lives in
 * tests/unit/graviscan/verify-plates.test.ts, exercised against the real
 * exported `verifyPlates()` function instead.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

// Fixture directory
const FIXTURES_DIR = path.join(__dirname, '../fixtures/graviscan-qr-images');

const hasFixtures =
  fs.existsSync(FIXTURES_DIR) &&
  fs.readdirSync(FIXTURES_DIR).some((f) => f.endsWith('.tif'));

// ─── QR Reader Tests (require fixture images) ────────────────

describe('QR Reader', () => {
  // Skip if fixture images not present
  const testOrSkip = hasFixtures ? it : it.skip;

  testOrSkip('should read QR codes from plate13 image', async () => {
    const { readQrCodes } = await import('../../src/main/qr-reader');
    const imagePath = path.join(FIXTURES_DIR, 'plate13_S1_00.tif');
    const codes = await readQrCodes(imagePath);

    expect(codes.length).toBeGreaterThan(0);
    expect(codes.some((c) => c.includes('Plate_13'))).toBe(true);
  });

  testOrSkip('should read QR codes from plate11 image', async () => {
    const { readQrCodes } = await import('../../src/main/qr-reader');
    const imagePath = path.join(FIXTURES_DIR, 'plate11_S2_10.tif');
    const codes = await readQrCodes(imagePath);

    expect(codes.length).toBe(4);
    expect(codes.some((c) => c.includes('Plate_11'))).toBe(true);
  });

  testOrSkip('should read QR codes from plate12 image', async () => {
    const { readQrCodes } = await import('../../src/main/qr-reader');
    const imagePath = path.join(FIXTURES_DIR, 'plate12_S2_11.tif');
    const codes = await readQrCodes(imagePath);

    expect(codes.length).toBeGreaterThan(0);
    expect(codes.some((c) => c.includes('Plate_12'))).toBe(true);
  });

  testOrSkip('should read QR codes from plate16 image', async () => {
    const { readQrCodes } = await import('../../src/main/qr-reader');
    const imagePath = path.join(FIXTURES_DIR, 'plate16_S1_11.tif');
    const codes = await readQrCodes(imagePath);

    expect(codes.length).toBeGreaterThan(0);
    expect(codes.some((c) => c.includes('Plate_16'))).toBe(true);
  });

  testOrSkip('should return empty array for non-existent image', async () => {
    const { readQrCodes } = await import('../../src/main/qr-reader');
    const codes = await readQrCodes('/non/existent/image.tif');

    expect(codes).toEqual([]);
  });

  testOrSkip('should detect all 4 plates from 4 images', async () => {
    const { readQrCodes } = await import('../../src/main/qr-reader');

    const images = [
      { file: 'plate13_S1_00.tif', expectedPlate: 'Plate_13' },
      { file: 'plate16_S1_11.tif', expectedPlate: 'Plate_16' },
      { file: 'plate11_S2_10.tif', expectedPlate: 'Plate_11' },
      { file: 'plate12_S2_11.tif', expectedPlate: 'Plate_12' },
    ];

    for (const img of images) {
      const codes = await readQrCodes(path.join(FIXTURES_DIR, img.file));
      expect(codes.length).toBeGreaterThan(0);
      expect(codes.some((c) => c.includes(img.expectedPlate))).toBe(true);
    }
  });
});

// ─── Non-fixture behavior tests (real function, no images needed) ────

describe('QR Reader — no-fixture behavior', () => {
  it('returns empty array for a non-existent image without throwing', async () => {
    const { readQrCodes } = await import('../../src/main/qr-reader');
    const codes = await readQrCodes(
      path.join(FIXTURES_DIR, 'definitely-does-not-exist.tif')
    );
    expect(codes).toEqual([]);
  });

  it('serializes concurrent calls without throwing', async () => {
    const { readQrCodes } = await import('../../src/main/qr-reader');
    const missingPath = path.join(FIXTURES_DIR, 'still-does-not-exist.tif');

    const results = await Promise.all([
      readQrCodes(missingPath),
      readQrCodes(missingPath),
      readQrCodes(missingPath),
    ]);

    expect(results).toEqual([[], [], []]);
  });
});
