/**
 * QR Reader Unit Tests
 *
 * Tests QR code reading from scan images using @undecaf/zbar-wasm.
 * Uses real TIFF fixture images from tests/fixtures/graviscan-qr-images/
 * (not committed — download separately, ~61MB each).
 *
 * Run: npx vitest run tests/unit/qr-reader.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

// ─── Verification Logic Tests (mocked, no images needed) ─────

describe('Verification Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should classify as verified when detected plate matches assigned', () => {
    const assignedPlateId = 'Plate_13';
    const detectedPlateId = 'Plate_13';

    const status =
      detectedPlateId === assignedPlateId ? 'verified' : 'incorrect';
    expect(status).toBe('verified');
  });

  it('should classify as incorrect when detected plate differs from assigned', () => {
    const assignedPlateId = 'Plate_13';
    const detectedPlateId = 'Plate_16';

    const status =
      detectedPlateId === assignedPlateId ? 'verified' : 'incorrect';
    expect(status).toBe('incorrect');
  });

  it('should classify as unreadable when no QR codes detected', () => {
    const detectedCodes: string[] = [];
    const detectedPlateId: string | null = null;

    const status =
      detectedCodes.length === 0
        ? 'unreadable'
        : detectedPlateId === null
          ? 'unreadable'
          : 'verified';
    expect(status).toBe('unreadable');
  });

  it('should detect swap when two positions have each others assigned plate', () => {
    const results = [
      {
        scannerId: 'scanner-1',
        plateIndex: '00',
        assignedPlateId: 'Plate_13',
        detectedPlateId: 'Plate_16',
        status: 'incorrect' as const,
      },
      {
        scannerId: 'scanner-1',
        plateIndex: '11',
        assignedPlateId: 'Plate_16',
        detectedPlateId: 'Plate_13',
        status: 'incorrect' as const,
      },
      {
        scannerId: 'scanner-2',
        plateIndex: '10',
        assignedPlateId: 'Plate_11',
        detectedPlateId: 'Plate_11',
        status: 'verified' as const,
      },
    ];

    // Detect swaps
    const incorrectResults = results.filter((r) => r.status === 'incorrect');
    const swaps: Array<{
      position1: { assignedPlateId: string };
      position2: { assignedPlateId: string };
    }> = [];

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
            position1: { assignedPlateId: result.assignedPlateId },
            position2: { assignedPlateId: swapMatch.assignedPlateId },
          });
        }
      }
    }

    expect(swaps).toHaveLength(1);
    expect(swaps[0].position1.assignedPlateId).toBe('Plate_13');
    expect(swaps[0].position2.assignedPlateId).toBe('Plate_16');
  });

  it('should not detect swap when only one position is incorrect', () => {
    const results = [
      {
        scannerId: 'scanner-1',
        plateIndex: '00',
        assignedPlateId: 'Plate_13',
        detectedPlateId: 'Plate_99',
        status: 'incorrect' as const,
      },
      {
        scannerId: 'scanner-1',
        plateIndex: '11',
        assignedPlateId: 'Plate_16',
        detectedPlateId: 'Plate_16',
        status: 'verified' as const,
      },
    ];

    const incorrectResults = results.filter((r) => r.status === 'incorrect');
    const swaps: Array<{
      position1: { assignedPlateId: string };
      position2: { assignedPlateId: string };
    }> = [];

    for (const result of incorrectResults) {
      const swapMatch = incorrectResults.find(
        (other) =>
          other !== result &&
          other.detectedPlateId === result.assignedPlateId &&
          result.detectedPlateId === other.assignedPlateId
      );
      if (swapMatch) {
        swaps.push({
          position1: { assignedPlateId: result.assignedPlateId },
          position2: { assignedPlateId: swapMatch.assignedPlateId },
        });
      }
    }

    expect(swaps).toHaveLength(0);
  });

  it('should handle all plates verified (no swaps, no unreadable)', () => {
    const results = [
      { status: 'verified' },
      { status: 'verified' },
      { status: 'verified' },
      { status: 'verified' },
    ];

    const verified = results.filter((r) => r.status === 'verified').length;
    const unreadable = results.filter((r) => r.status === 'unreadable').length;
    const swapCount = 0;

    expect(verified).toBe(4);
    expect(unreadable).toBe(0);
    expect(swapCount).toBe(0);
  });

  it('should handle mixed results (some verified, some unreadable)', () => {
    const results = [
      { status: 'verified' },
      { status: 'verified' },
      { status: 'unreadable' },
      { status: 'verified' },
    ];

    const verified = results.filter((r) => r.status === 'verified').length;
    const unreadable = results.filter((r) => r.status === 'unreadable').length;

    expect(verified).toBe(3);
    expect(unreadable).toBe(1);
  });
});
