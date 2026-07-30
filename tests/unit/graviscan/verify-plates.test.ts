// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/main/qr-reader', () => ({
  readQrCodes: vi.fn(),
  readQrCodesBatch: vi.fn(),
}));

import { readQrCodesBatch } from '../../../src/main/qr-reader';
import { verifyPlates } from '../../../src/main/graviscan/verify-plates';

const mockReadQrCodesBatch = vi.mocked(readQrCodesBatch);

/**
 * Stub the batched decoder with a path -> codes lookup.
 *
 * The handler decodes the whole batch in ONE subprocess call, so tests
 * describe what each image contains rather than relying on call ordering.
 */
function setCodes(codesByPath: Record<string, string[]>) {
  mockReadQrCodesBatch.mockImplementation(async (paths: string[]) =>
    paths.map((p) => ({ path: p, codes: codesByPath[p] ?? [] }))
  );
}

function createMockDb() {
  return {
    graviPlateSectionMapping: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    graviScanPlateAssignment: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    graviScan: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
  } as any;
}

function mapping(plateId: string, plantQr: string) {
  return { plant_qr: plantQr, plate: { plate_id: plateId } };
}

describe('verifyPlates', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockReadQrCodesBatch.mockReset();
    setCodes({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('decodes every plate image in a single batched subprocess call', async () => {
    // The one-shot-subprocess design only pays off if a verification batch
    // costs ONE spawn. Decoding per-plate in a loop would spawn N times.
    setCodes({ '/scan1.tif': ['qr-13'], '/scan2.tif': ['qr-16'] });
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13')])
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16')]);

    await verifyPlates(db, [
      {
        scannerId: 's1',
        plateIndex: '00',
        imagePath: '/scan1.tif',
        assignedPlateId: 'plate_13',
      },
      {
        scannerId: 's1',
        plateIndex: '11',
        imagePath: '/scan2.tif',
        assignedPlateId: 'plate_16',
      },
    ]);

    expect(mockReadQrCodesBatch).toHaveBeenCalledTimes(1);
    expect(mockReadQrCodesBatch).toHaveBeenCalledWith([
      '/scan1.tif',
      '/scan2.tif',
    ]);
  });

  it('maps batch results back to each plate by image path, not by position', async () => {
    // A decoder that returns results in a different order than requested must
    // not shift codes onto the wrong plate.
    mockReadQrCodesBatch.mockResolvedValueOnce([
      { path: '/scan2.tif', codes: ['qr-16'] },
      { path: '/scan1.tif', codes: ['qr-13'] },
    ]);
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13')])
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16')]);

    const result = await verifyPlates(db, [
      {
        scannerId: 's1',
        plateIndex: '00',
        imagePath: '/scan1.tif',
        assignedPlateId: 'plate_13',
      },
      {
        scannerId: 's1',
        plateIndex: '11',
        imagePath: '/scan2.tif',
        assignedPlateId: 'plate_16',
      },
    ]);

    expect(result.results[0].detectedCodes).toEqual(['qr-13']);
    expect(result.results[1].detectedCodes).toEqual(['qr-16']);
    expect(result.results[0].status).toBe('verified');
    expect(result.results[1].status).toBe('verified');
  });

  it('classifies a plate as verified when the detected plate matches the assignment', async () => {
    setCodes({ '/scan1.tif': ['qr-1'] });
    db.graviPlateSectionMapping.findMany.mockResolvedValueOnce([
      mapping('plate_13', 'qr-1'),
    ]);

    const result = await verifyPlates(db, [
      {
        scannerId: 's1',
        plateIndex: '00',
        imagePath: '/scan1.tif',
        assignedPlateId: 'plate_13',
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe('verified');
    expect(result.results[0].detectedPlateId).toBe('plate_13');
    expect(result.swaps).toEqual([]);

    // verification_status persisted as 'verified'
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { scanner_id: 's1', plate_index: '00' },
      data: { verification_status: 'verified' },
    });
  });

  it('classifies a plate as unreadable when no QR codes are detected', async () => {
    setCodes({ '/scan1.tif': [] });

    const result = await verifyPlates(db, [
      {
        scannerId: 's1',
        plateIndex: '00',
        imagePath: '/scan1.tif',
        assignedPlateId: 'plate_13',
      },
    ]);

    expect(result.results[0].status).toBe('unreadable');
    expect(result.results[0].detectedPlateId).toBeNull();
    // No DB lookup should even be attempted for an unreadable plate
    expect(db.graviPlateSectionMapping.findMany).not.toHaveBeenCalled();
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { scanner_id: 's1', plate_index: '00' },
      data: { verification_status: 'unreadable' },
    });
  });

  it('classifies a lone incorrect plate (no swap partner) and persists unreadable', async () => {
    setCodes({ '/scan1.tif': ['qr-99'] });
    db.graviPlateSectionMapping.findMany.mockResolvedValueOnce([
      mapping('plate_99', 'qr-99'),
    ]);

    const result = await verifyPlates(db, [
      {
        scannerId: 's1',
        plateIndex: '00',
        imagePath: '/scan1.tif',
        assignedPlateId: 'plate_13',
      },
    ]);

    expect(result.results[0].status).toBe('incorrect');
    expect(result.results[0].detectedPlateId).toBe('plate_99');
    expect(result.swaps).toEqual([]);
    // Production semantics: an 'incorrect' result with no detected swap
    // partner is persisted as 'unreadable' rather than 'incorrect'.
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { scanner_id: 's1', plate_index: '00' },
      data: { verification_status: 'unreadable' },
    });
  });

  it('flags needs_review when QR codes on one plate disagree about the plate id', async () => {
    setCodes({ '/scan1.tif': ['qr-a', 'qr-b', 'qr-c'] });
    db.graviPlateSectionMapping.findMany.mockResolvedValueOnce([
      mapping('plate_13', 'qr-a'),
      mapping('plate_13', 'qr-b'),
      mapping('plate_16', 'qr-c'),
    ]);

    const result = await verifyPlates(db, [
      {
        scannerId: 's1',
        plateIndex: '00',
        imagePath: '/scan1.tif',
        assignedPlateId: 'plate_13',
      },
    ]);

    expect(result.results[0].status).toBe('needs_review');
    // Majority (2 codes) wins
    expect(result.results[0].detectedPlateId).toBe('plate_13');
    expect(result.results[0].inconsistentMappings).toEqual({
      plate_13: ['qr-a', 'qr-b'],
      plate_16: ['qr-c'],
    });
    expect(result.swaps).toEqual([]);
  });

  it('flags duplicate_qr when the same code is detected on two plates in the batch', async () => {
    setCodes({ '/scan1.tif': ['qr-dup'], '/scan2.tif': ['qr-dup'] });

    const result = await verifyPlates(db, [
      {
        scannerId: 's1',
        plateIndex: '00',
        imagePath: '/scan1.tif',
        assignedPlateId: 'plate_13',
      },
      {
        scannerId: 's1',
        plateIndex: '11',
        imagePath: '/scan2.tif',
        assignedPlateId: 'plate_16',
      },
    ]);

    expect(result.results[0].status).toBe('duplicate_qr');
    expect(result.results[1].status).toBe('duplicate_qr');
    expect(result.results[0].duplicateQrCodes).toEqual(['qr-dup']);
    // Duplicate plates skip the DB lookup entirely
    expect(db.graviPlateSectionMapping.findMany).not.toHaveBeenCalled();
  });

  it('detects a swap between two plates and auto-corrects DB records', async () => {
    // Plate at position 00 (assigned plate_13) actually reads plate_16's QR
    // Plate at position 11 (assigned plate_16) actually reads plate_13's QR
    setCodes({ '/scan1.tif': ['qr-16'], '/scan2.tif': ['qr-13'] });
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16')])
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13')]);

    const scan1 = { id: 'scan-1' };
    const scan2 = { id: 'scan-2' };
    db.graviScan.findFirst
      .mockResolvedValueOnce(scan1)
      .mockResolvedValueOnce(scan2);

    const result = await verifyPlates(db, [
      {
        scannerId: 's1',
        plateIndex: '00',
        imagePath: '/scan1.tif',
        assignedPlateId: 'plate_13',
      },
      {
        scannerId: 's1',
        plateIndex: '11',
        imagePath: '/scan2.tif',
        assignedPlateId: 'plate_16',
      },
    ]);

    expect(result.swaps).toHaveLength(1);
    expect(result.swaps[0]).toEqual({
      position1: {
        scannerId: 's1',
        plateIndex: '00',
        assignedPlateId: 'plate_13',
      },
      position2: {
        scannerId: 's1',
        plateIndex: '11',
        assignedPlateId: 'plate_16',
      },
    });

    // GraviScanPlateAssignment.plate_barcode swapped for both positions
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { scanner_id: 's1', plate_index: '00' },
      data: { plate_barcode: 'plate_16' },
    });
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { scanner_id: 's1', plate_index: '11' },
      data: { plate_barcode: 'plate_13' },
    });

    // GraviScan records updated to match
    expect(db.graviScan.update).toHaveBeenCalledWith({
      where: { id: 'scan-1' },
      data: { plate_barcode: 'plate_16' },
    });
    expect(db.graviScan.update).toHaveBeenCalledWith({
      where: { id: 'scan-2' },
      data: { plate_barcode: 'plate_13' },
    });

    // Final verification_status is 'swapped' for both positions
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { scanner_id: 's1', plate_index: '00' },
      data: { verification_status: 'swapped' },
    });
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { scanner_id: 's1', plate_index: '11' },
      data: { verification_status: 'swapped' },
    });
  });

  it('scopes the GraviPlateSectionMapping lookup to the given experimentId', async () => {
    setCodes({ '/scan1.tif': ['qr-1'] });
    db.graviPlateSectionMapping.findMany.mockResolvedValueOnce([
      mapping('plate_13', 'qr-1'),
    ]);

    await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scan1.tif',
          assignedPlateId: 'plate_13',
        },
      ],
      'exp-1'
    );

    expect(db.graviPlateSectionMapping.findMany).toHaveBeenCalledWith({
      where: {
        plant_qr: { in: ['qr-1'] },
        plate: {
          metadata_file: {
            experiments: { some: { id: 'exp-1' } },
          },
        },
      },
      include: { plate: true },
    });
  });

  it('does not scope the lookup when experimentId is omitted', async () => {
    setCodes({ '/scan1.tif': ['qr-1'] });
    db.graviPlateSectionMapping.findMany.mockResolvedValueOnce([
      mapping('plate_13', 'qr-1'),
    ]);

    await verifyPlates(db, [
      {
        scannerId: 's1',
        plateIndex: '00',
        imagePath: '/scan1.tif',
        assignedPlateId: 'plate_13',
      },
    ]);

    expect(db.graviPlateSectionMapping.findMany).toHaveBeenCalledWith({
      where: { plant_qr: { in: ['qr-1'] } },
      include: { plate: true },
    });
  });

  it('continues processing the batch when one verification_status write throws', async () => {
    setCodes({ '/scan1.tif': ['qr-13'], '/scan2.tif': ['qr-16'] });
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13')])
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16')]);

    // First updateMany call (verified plate's status write) throws; the
    // second plate's write must still be attempted.
    db.graviScanPlateAssignment.updateMany
      .mockRejectedValueOnce(new Error('DB write failed'))
      .mockResolvedValue({ count: 1 });

    const result = await verifyPlates(db, [
      {
        scannerId: 's1',
        plateIndex: '00',
        imagePath: '/scan1.tif',
        assignedPlateId: 'plate_13',
      },
      {
        scannerId: 's1',
        plateIndex: '11',
        imagePath: '/scan2.tif',
        assignedPlateId: 'plate_16',
      },
    ]);

    // The overall handler does not throw/abort — both results are present
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].status).toBe('verified');
    expect(result.results[1].status).toBe('verified');
    // The second plate's status update was still attempted despite the
    // first one throwing.
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { scanner_id: 's1', plate_index: '11' },
      data: { verification_status: 'verified' },
    });
    expect(console.error).toHaveBeenCalledWith(
      '[GraviScan:VERIFY] Failed to update verification_status:',
      expect.any(Error)
    );
  });

  it('continues processing when a swap correction DB write throws', async () => {
    setCodes({ '/scan1.tif': ['qr-16'], '/scan2.tif': ['qr-13'] });
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16')])
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13')]);

    // The first updateMany call is the swap-correction write for position1 —
    // make it throw and confirm the rest of the handler still completes.
    db.graviScanPlateAssignment.updateMany
      .mockRejectedValueOnce(new Error('swap write failed'))
      .mockResolvedValue({ count: 1 });

    const result = await verifyPlates(db, [
      {
        scannerId: 's1',
        plateIndex: '00',
        imagePath: '/scan1.tif',
        assignedPlateId: 'plate_13',
      },
      {
        scannerId: 's1',
        plateIndex: '11',
        imagePath: '/scan2.tif',
        assignedPlateId: 'plate_16',
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.swaps).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith(
      '[GraviScan:VERIFY] Failed to correct swap:',
      expect.any(Error)
    );
    // Final verification_status writes for both positions were still attempted
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { scanner_id: 's1', plate_index: '00' },
      data: { verification_status: 'swapped' },
    });
  });

  it('emits verify-started, verify-result (per plate), and verify-complete progress events', async () => {
    setCodes({ '/scan1.tif': ['qr-1'] });
    db.graviPlateSectionMapping.findMany.mockResolvedValueOnce([
      mapping('plate_13', 'qr-1'),
    ]);

    const onProgress = vi.fn();

    await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scan1.tif',
          assignedPlateId: 'plate_13',
        },
      ],
      undefined,
      onProgress
    );

    expect(onProgress).toHaveBeenCalledWith({ type: 'verify-started' });
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'verify-result' })
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'verify-complete' })
    );
  });

  it('works without a progress callback (renderer-less)', async () => {
    setCodes({ '/scan1.tif': ['qr-1'] });
    db.graviPlateSectionMapping.findMany.mockResolvedValueOnce([
      mapping('plate_13', 'qr-1'),
    ]);

    const result = await verifyPlates(db, [
      {
        scannerId: 's1',
        plateIndex: '00',
        imagePath: '/scan1.tif',
        assignedPlateId: 'plate_13',
      },
    ]);

    expect(result.success).toBe(true);
  });

  it('returns a failure result if the top-level pipeline throws unexpectedly', async () => {
    mockReadQrCodesBatch.mockRejectedValueOnce(new Error('decoder exploded'));

    const result = await verifyPlates(db, [
      {
        scannerId: 's1',
        plateIndex: '00',
        imagePath: '/scan1.tif',
        assignedPlateId: 'plate_13',
      },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toBe('decoder exploded');
    expect(result.results).toEqual([]);
    expect(result.swaps).toEqual([]);
  });
});
