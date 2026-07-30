// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/main/qr-reader', () => ({
  readQrCodes: vi.fn(),
  readQrCodesBatch: vi.fn(),
}));

// The realpath-containment check runs for real against these POSIX-style
// fixture paths; only the symlink resolution itself is stubbed to identity,
// matching register-handlers.test.ts's convention.
vi.mock('fs', () => ({
  realpathSync: vi.fn((p: string) => p),
}));

import * as path from 'path';
import * as fs from 'fs';
import { readQrCodesBatch } from '../../../src/main/qr-reader';
import { verifyPlates } from '../../../src/main/graviscan/verify-plates';

const mockReadQrCodesBatch = vi.mocked(readQrCodesBatch);

/** Configured scan output directory every fixture image lives under. */
const OUTPUT_DIR = '/scans';

/**
 * Stub the batched decoder with a path -> codes lookup.
 *
 * The handler decodes the whole batch in ONE subprocess call, so tests
 * describe what each image contains rather than relying on call ordering.
 * Keys are resolved the same way the handler resolves them before decoding.
 */
function setCodes(codesByPath: Record<string, string[]>) {
  const byResolved = new Map(
    Object.entries(codesByPath).map(([p, codes]) => [path.resolve(p), codes])
  );
  mockReadQrCodesBatch.mockImplementation(async (paths: string[]) =>
    paths.map((p) => {
      const codes: string[] = byResolved.get(p) ?? [];
      return { path: p, codes };
    })
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
    // Default: symlink resolution is identity, so containment is decided by
    // the real path math against these POSIX-style fixture paths.
    vi.mocked(fs.realpathSync).mockImplementation(
      ((p: string) => p) as unknown as typeof fs.realpathSync
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('decodes every plate image in a single batched subprocess call', async () => {
    // The one-shot-subprocess design only pays off if a verification batch
    // costs ONE spawn. Decoding per-plate in a loop would spawn N times.
    setCodes({ '/scans/scan1.tif': ['qr-13'], '/scans/scan2.tif': ['qr-16'] });
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13')])
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16')]);

    await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
        {
          scannerId: 's1',
          plateIndex: '11',
          imagePath: '/scans/scan2.tif',
          assignedPlateId: 'plate_16',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(mockReadQrCodesBatch).toHaveBeenCalledTimes(1);
    expect(mockReadQrCodesBatch).toHaveBeenCalledWith([
      path.resolve('/scans/scan1.tif'),
      path.resolve('/scans/scan2.tif'),
    ]);
  });

  it('maps batch results back to each plate by image path, not by position', async () => {
    // A decoder that returns results in a different order than requested must
    // not shift codes onto the wrong plate.
    mockReadQrCodesBatch.mockResolvedValueOnce([
      { path: path.resolve('/scans/scan2.tif'), codes: ['qr-16'] },
      { path: path.resolve('/scans/scan1.tif'), codes: ['qr-13'] },
    ]);
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13')])
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16')]);

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
        {
          scannerId: 's1',
          plateIndex: '11',
          imagePath: '/scans/scan2.tif',
          assignedPlateId: 'plate_16',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.results[0].detectedCodes).toEqual(['qr-13']);
    expect(result.results[1].detectedCodes).toEqual(['qr-16']);
    expect(result.results[0].status).toBe('verified');
    expect(result.results[1].status).toBe('verified');
  });

  it('classifies a plate as verified when the detected plate matches the assignment', async () => {
    setCodes({ '/scans/scan1.tif': ['qr-1'] });
    db.graviPlateSectionMapping.findMany.mockResolvedValueOnce([
      mapping('plate_13', 'qr-1'),
    ]);

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe('verified');
    expect(result.results[0].detectedPlateId).toBe('plate_13');
    expect(result.swaps).toEqual([]);

    // verification_status persisted as 'verified'
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { experiment_id: 'exp-1', scanner_id: 's1', plate_index: '00' },
      data: { verification_status: 'verified' },
    });
  });

  it('matches a mixed-case plate id case-insensitively on both sides', async () => {
    // The DB-side plate_id is lowercased before grouping. Real plate IDs in
    // this codebase are mixed-case ("Plate_13"), so comparing the lowercased
    // DB value against a raw assignedPlateId never matched and every
    // correctly-scanned plate came back `incorrect`.
    setCodes({ '/scans/scan1.tif': ['qr-1'] });
    db.graviPlateSectionMapping.findMany.mockResolvedValueOnce([
      mapping('Plate_13', 'qr-1'),
    ]);

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'Plate_13',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.results[0].status).toBe('verified');
  });

  it('detects a swap between two mixed-case plate ids', async () => {
    setCodes({ '/scans/scan1.tif': ['qr-16'], '/scans/scan2.tif': ['qr-13'] });
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('Plate_16', 'qr-16')])
      .mockResolvedValueOnce([mapping('Plate_13', 'qr-13')]);

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'Plate_13',
        },
        {
          scannerId: 's1',
          plateIndex: '11',
          imagePath: '/scans/scan2.tif',
          assignedPlateId: 'Plate_16',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.swaps).toHaveLength(1);
    // The correction writes the plate ids back in their ORIGINAL casing —
    // only the comparison is case-insensitive.
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { experiment_id: 'exp-1', scanner_id: 's1', plate_index: '00' },
      data: expect.objectContaining({ plate_barcode: 'Plate_16' }),
    });
  });

  it('rejects an imagePath outside the scan output directory before decoding', async () => {
    setCodes({ '/scans/scan1.tif': ['qr-1'], '/etc/passwd': ['qr-evil'] });
    db.graviPlateSectionMapping.findMany.mockResolvedValue([
      mapping('plate_13', 'qr-1'),
    ]);

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
        {
          scannerId: 's1',
          plateIndex: '11',
          imagePath: '/etc/passwd',
          assignedPlateId: 'plate_16',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    // The out-of-tree path is never handed to the decoder at all.
    expect(mockReadQrCodesBatch).toHaveBeenCalledWith([
      path.resolve('/scans/scan1.tif'),
    ]);
    expect(result.results[0].status).toBe('verified');
    expect(result.results[1].status).toBe('unreadable');
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('outside the scan output directory'),
      '/etc/passwd'
    );
  });

  it('logs a missing image as a skip, not as a security rejection', async () => {
    // A capture that has not landed yet (or was moved) is the ordinary case.
    // realpathSync throws for it, so containment cannot be proven and the
    // plate is still skipped — but logging that at error level as "outside
    // the scan output directory" would cry wolf on a benign condition.
    vi.mocked(fs.realpathSync).mockImplementation(((p: string) => {
      if (String(p).includes('not-yet-written')) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return p;
    }) as unknown as typeof fs.realpathSync);

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/not-yet-written.tif',
          assignedPlateId: 'plate_13',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.results[0].status).toBe('unreadable');
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not be resolved'),
      '/scans/not-yet-written.tif'
    );
    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringContaining('outside the scan output directory'),
      expect.anything()
    );
  });

  it('rejects a `..` traversal that escapes the scan output directory', async () => {
    setCodes({ '/scans/../etc/passwd': ['qr-evil'] });

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/../etc/passwd',
          assignedPlateId: 'plate_13',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    // Nothing left to decode — the batch handed to the decoder is empty.
    expect(mockReadQrCodesBatch).toHaveBeenCalledWith([]);
    expect(result.results[0].status).toBe('unreadable');
  });

  it('classifies a plate as unreadable when no QR codes are detected', async () => {
    setCodes({ '/scans/scan1.tif': [] });

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.results[0].status).toBe('unreadable');
    expect(result.results[0].detectedPlateId).toBeNull();
    // No DB lookup should even be attempted for an unreadable plate
    expect(db.graviPlateSectionMapping.findMany).not.toHaveBeenCalled();
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { experiment_id: 'exp-1', scanner_id: 's1', plate_index: '00' },
      data: { verification_status: 'unreadable' },
    });
  });

  it('persists a lone incorrect plate (no swap partner) as incorrect, not unreadable', async () => {
    setCodes({ '/scans/scan1.tif': ['qr-99'] });
    db.graviPlateSectionMapping.findMany.mockResolvedValueOnce([
      mapping('plate_99', 'qr-99'),
    ]);

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.results[0].status).toBe('incorrect');
    expect(result.results[0].detectedPlateId).toBe('plate_99');
    expect(result.swaps).toEqual([]);
    // Deliberate departure from production, which collapses this case into
    // 'unreadable'. "QR read fine, wrong plate" and "QR could not be read at
    // all" are differently actionable for an operator and must stay
    // distinguishable in persisted data.
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { experiment_id: 'exp-1', scanner_id: 's1', plate_index: '00' },
      data: { verification_status: 'incorrect' },
    });
    expect(db.graviScanPlateAssignment.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: { verification_status: 'unreadable' },
      })
    );
  });

  it('reports a failed plate-id lookup as lookup_failed, not unreadable', async () => {
    // A transient DB error is NOT "no QR code was readable". Collapsing it
    // into `unreadable` is the same status-collapse bug this module already
    // refuses to make for `incorrect`: the operator would be told to go
    // re-image a plate whose image was fine all along, and the persisted
    // record would misstate why verification did not conclude.
    setCodes({ '/scans/scan1.tif': ['qr-1'] });
    db.graviPlateSectionMapping.findMany.mockRejectedValueOnce(
      new Error('database is locked')
    );

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.results[0].status).toBe('lookup_failed');
    expect(result.results[0].detectedPlateId).toBeNull();
    // The codes that WERE decoded are still reported — the image was fine.
    expect(result.results[0].detectedCodes).toEqual(['qr-1']);
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { experiment_id: 'exp-1', scanner_id: 's1', plate_index: '00' },
      data: { verification_status: 'lookup_failed' },
    });
    expect(db.graviScanPlateAssignment.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { verification_status: 'unreadable' } })
    );
  });

  it('does not pair a lookup_failed plate into a swap', async () => {
    // A plate whose lookup failed has no known detected plate id, so it is
    // not evidence of anything and must not be auto-corrected against.
    setCodes({ '/scans/scan1.tif': ['qr-16'], '/scans/scan2.tif': ['qr-13'] });
    db.graviPlateSectionMapping.findMany
      .mockRejectedValueOnce(new Error('database is locked'))
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13')]);

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
        {
          scannerId: 's1',
          plateIndex: '11',
          imagePath: '/scans/scan2.tif',
          assignedPlateId: 'plate_16',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.results[0].status).toBe('lookup_failed');
    expect(result.results[1].status).toBe('incorrect');
    expect(result.swaps).toEqual([]);
  });

  it('flags needs_review when QR codes on one plate disagree about the plate id', async () => {
    setCodes({ '/scans/scan1.tif': ['qr-a', 'qr-b', 'qr-c'] });
    db.graviPlateSectionMapping.findMany.mockResolvedValueOnce([
      mapping('plate_13', 'qr-a'),
      mapping('plate_13', 'qr-b'),
      mapping('plate_16', 'qr-c'),
    ]);

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

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
    setCodes({
      '/scans/scan1.tif': ['qr-dup'],
      '/scans/scan2.tif': ['qr-dup'],
    });

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
        {
          scannerId: 's1',
          plateIndex: '11',
          imagePath: '/scans/scan2.tif',
          assignedPlateId: 'plate_16',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.results[0].status).toBe('duplicate_qr');
    expect(result.results[1].status).toBe('duplicate_qr');
    expect(result.results[0].duplicateQrCodes).toEqual(['qr-dup']);
    // Duplicate plates skip the DB lookup entirely
    expect(db.graviPlateSectionMapping.findMany).not.toHaveBeenCalled();
  });

  it('does not flag an innocent plate that merely shares a plate index with a duplicate', async () => {
    // Duplicate detection keyed on plateIndex alone: s1:00 and s2:11 share
    // 'qr-A', which marks index '00' as duplicated — dragging in s2:00, an
    // unrelated plate on a different scanner whose own QR is unique.
    setCodes({
      '/scans/s1-00.tif': ['qr-A'],
      '/scans/s2-11.tif': ['qr-A'],
      '/scans/s2-00.tif': ['qr-unique'],
    });
    db.graviPlateSectionMapping.findMany.mockResolvedValue([
      mapping('plate_77', 'qr-unique'),
    ]);

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/s1-00.tif',
          assignedPlateId: 'plate_13',
        },
        {
          scannerId: 's2',
          plateIndex: '11',
          imagePath: '/scans/s2-11.tif',
          assignedPlateId: 'plate_16',
        },
        {
          scannerId: 's2',
          plateIndex: '00',
          imagePath: '/scans/s2-00.tif',
          assignedPlateId: 'plate_77',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.results[0].status).toBe('duplicate_qr');
    expect(result.results[1].status).toBe('duplicate_qr');
    expect(result.results[2].status).toBe('verified');
  });

  it('flags a duplicate QR shared by two scanners at the same plate index', async () => {
    // The mirror image of the above: keyed on plateIndex alone, both plates
    // collapse to the single grid '00' and the duplicate goes undetected.
    setCodes({
      '/scans/s1-00.tif': ['qr-dup'],
      '/scans/s2-00.tif': ['qr-dup'],
    });

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/s1-00.tif',
          assignedPlateId: 'plate_13',
        },
        {
          scannerId: 's2',
          plateIndex: '00',
          imagePath: '/scans/s2-00.tif',
          assignedPlateId: 'plate_16',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.results[0].status).toBe('duplicate_qr');
    expect(result.results[1].status).toBe('duplicate_qr');
  });

  it('records two independent swap pairs that share the same assigned plate ids', async () => {
    // Both scanners carry the same two plate ids at positions 00/11 (a
    // duplicated assignment, or duplicated plant_qr -> plate_id metadata) and
    // both got physically swapped. Every QR string is distinct, so this is
    // not a duplicate-QR case — the collision is purely in assignedPlateId,
    // which is exactly what swap dedup used to key on: the two independent
    // pairs collapsed into one and the second scanner stayed uncorrected.
    setCodes({
      '/scans/s1-00.tif': ['qr-16a'],
      '/scans/s1-11.tif': ['qr-13a'],
      '/scans/s2-00.tif': ['qr-16b'],
      '/scans/s2-11.tif': ['qr-13b'],
    });
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16a')])
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13a')])
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16b')])
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13b')]);

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/s1-00.tif',
          assignedPlateId: 'plate_13',
        },
        {
          scannerId: 's1',
          plateIndex: '11',
          imagePath: '/scans/s1-11.tif',
          assignedPlateId: 'plate_16',
        },
        {
          scannerId: 's2',
          plateIndex: '00',
          imagePath: '/scans/s2-00.tif',
          assignedPlateId: 'plate_13',
        },
        {
          scannerId: 's2',
          plateIndex: '11',
          imagePath: '/scans/s2-11.tif',
          assignedPlateId: 'plate_16',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.swaps).toEqual([
      {
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
      },
      {
        position1: {
          scannerId: 's2',
          plateIndex: '00',
          assignedPlateId: 'plate_13',
        },
        position2: {
          scannerId: 's2',
          plateIndex: '11',
          assignedPlateId: 'plate_16',
        },
      },
    ]);

    // All four positions were corrected and marked swapped.
    for (const [scannerId, plateIndex] of [
      ['s1', '00'],
      ['s1', '11'],
      ['s2', '00'],
      ['s2', '11'],
    ]) {
      expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
        where: {
          experiment_id: 'exp-1',
          scanner_id: scannerId,
          plate_index: plateIndex,
        },
        data: { verification_status: 'swapped' },
      });
    }
  });

  it('detects a genuine cross-scanner swap when no same-scanner partner exists', async () => {
    // Plates physically swapped BETWEEN two scanners. Neither position has a
    // same-scanner reciprocal candidate, so this exercises the cross-scanner
    // fallback in the pairing search — the branch the same-scanner preference
    // would otherwise hide.
    setCodes({ '/scans/s1-00.tif': ['qr-16'], '/scans/s2-11.tif': ['qr-13'] });
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16')])
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13')]);
    db.graviScan.findFirst
      .mockResolvedValueOnce({ id: 'scan-1' })
      .mockResolvedValueOnce({ id: 'scan-2' });

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/s1-00.tif',
          assignedPlateId: 'plate_13',
        },
        {
          scannerId: 's2',
          plateIndex: '11',
          imagePath: '/scans/s2-11.tif',
          assignedPlateId: 'plate_16',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.swaps).toEqual([
      {
        position1: {
          scannerId: 's1',
          plateIndex: '00',
          assignedPlateId: 'plate_13',
        },
        position2: {
          scannerId: 's2',
          plateIndex: '11',
          assignedPlateId: 'plate_16',
        },
      },
    ]);

    // Both positions corrected across the scanner boundary.
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { experiment_id: 'exp-1', scanner_id: 's1', plate_index: '00' },
      data: {
        plate_barcode: 'plate_16',
        previous_plate_barcode: 'plate_13',
      },
    });
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { experiment_id: 'exp-1', scanner_id: 's2', plate_index: '11' },
      data: {
        plate_barcode: 'plate_13',
        previous_plate_barcode: 'plate_16',
      },
    });
    expect(db.graviScan.update).toHaveBeenCalledWith({
      where: { id: 'scan-1' },
      data: { plate_barcode: 'plate_16' },
    });
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { experiment_id: 'exp-1', scanner_id: 's2', plate_index: '11' },
      data: { verification_status: 'swapped' },
    });
  });

  it('does not pair a position with itself when two rows share one position', async () => {
    // The DB's @@unique([experiment_id, scanner_id, plate_index]) forbids
    // this, but nothing stops a caller from passing two rows for the same
    // slot. Distinguishing candidates by object identity alone would let the
    // two rows "swap" a position with itself and emit a bogus correction.
    setCodes({ '/scans/s1-00.tif': ['qr-16'], '/scans/s1-11.tif': ['qr-13'] });
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16')])
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13')]);

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/s1-00.tif',
          assignedPlateId: 'plate_13',
        },
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/s1-11.tif',
          assignedPlateId: 'plate_16',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.swaps).toEqual([]);
    expect(db.graviScan.update).not.toHaveBeenCalled();
    // No plate_barcode rewrite at all — only status persistence.
    for (const call of db.graviScanPlateAssignment.updateMany.mock.calls) {
      expect(call[0].data).not.toHaveProperty('plate_barcode');
    }
  });

  it('never pairs one position into two different swaps', async () => {
    // s1:11 is a valid reciprocal partner for both s1:00 and s2:00. Once it
    // has been consumed by the first pair it must not be reused.
    setCodes({
      '/scans/s1-00.tif': ['qr-16a'],
      '/scans/s1-11.tif': ['qr-13a'],
      '/scans/s2-00.tif': ['qr-16b'],
    });
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16a')])
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13a')])
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16b')]);

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/s1-00.tif',
          assignedPlateId: 'plate_13',
        },
        {
          scannerId: 's1',
          plateIndex: '11',
          imagePath: '/scans/s1-11.tif',
          assignedPlateId: 'plate_16',
        },
        {
          scannerId: 's2',
          plateIndex: '00',
          imagePath: '/scans/s2-00.tif',
          assignedPlateId: 'plate_13',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.swaps).toHaveLength(1);
    expect(result.swaps[0].position1.scannerId).toBe('s1');
    expect(result.swaps[0].position2.scannerId).toBe('s1');
    // The unpaired plate stays `incorrect`, not `swapped`.
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { experiment_id: 'exp-1', scanner_id: 's2', plate_index: '00' },
      data: { verification_status: 'incorrect' },
    });
  });

  it('detects a swap between two plates and auto-corrects DB records', async () => {
    // Plate at position 00 (assigned plate_13) actually reads plate_16's QR
    // Plate at position 11 (assigned plate_16) actually reads plate_13's QR
    setCodes({ '/scans/scan1.tif': ['qr-16'], '/scans/scan2.tif': ['qr-13'] });
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16')])
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13')]);

    const scan1 = { id: 'scan-1' };
    const scan2 = { id: 'scan-2' };
    db.graviScan.findFirst
      .mockResolvedValueOnce(scan1)
      .mockResolvedValueOnce(scan2);

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
        {
          scannerId: 's1',
          plateIndex: '11',
          imagePath: '/scans/scan2.tif',
          assignedPlateId: 'plate_16',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

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
      where: { experiment_id: 'exp-1', scanner_id: 's1', plate_index: '00' },
      data: {
        plate_barcode: 'plate_16',
        previous_plate_barcode: 'plate_13',
      },
    });
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { experiment_id: 'exp-1', scanner_id: 's1', plate_index: '11' },
      data: {
        plate_barcode: 'plate_13',
        previous_plate_barcode: 'plate_16',
      },
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
      where: { experiment_id: 'exp-1', scanner_id: 's1', plate_index: '00' },
      data: { verification_status: 'swapped' },
    });
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { experiment_id: 'exp-1', scanner_id: 's1', plate_index: '11' },
      data: { verification_status: 'swapped' },
    });
  });

  it('records the pre-correction plate_barcode when auto-correcting a swap', async () => {
    // "What was this corrected from" must be a queryable DB fact, not
    // something only inferable from application logs.
    setCodes({ '/scans/scan1.tif': ['qr-16'], '/scans/scan2.tif': ['qr-13'] });
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16')])
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13')]);

    await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
        {
          scannerId: 's1',
          plateIndex: '11',
          imagePath: '/scans/scan2.tif',
          assignedPlateId: 'plate_16',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { experiment_id: 'exp-1', scanner_id: 's1', plate_index: '00' },
      data: {
        plate_barcode: 'plate_16',
        previous_plate_barcode: 'plate_13',
      },
    });
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { experiment_id: 'exp-1', scanner_id: 's1', plate_index: '11' },
      data: {
        plate_barcode: 'plate_13',
        previous_plate_barcode: 'plate_16',
      },
    });
  });

  it('is idempotent — a second run over an already-corrected batch does not re-swap', async () => {
    // Verification can legitimately be re-run for a session (operator retry,
    // renderer resubmit). The second run reads the corrected assignments back
    // out of the DB, so it must see two verified plates, not swap them back.
    setCodes({ '/scans/scan1.tif': ['qr-16'], '/scans/scan2.tif': ['qr-13'] });
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16')])
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13')]);
    db.graviScan.findFirst
      .mockResolvedValueOnce({ id: 'scan-1' })
      .mockResolvedValueOnce({ id: 'scan-2' });

    const first = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
        {
          scannerId: 's1',
          plateIndex: '11',
          imagePath: '/scans/scan2.tif',
          assignedPlateId: 'plate_16',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );
    expect(first.swaps).toHaveLength(1);

    db.graviScanPlateAssignment.updateMany.mockClear();
    db.graviScan.update.mockClear();
    db.graviScan.findFirst.mockClear();
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16')])
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13')]);

    // Second run — assignedPlateId now carries the corrected plate_barcode
    // the first run wrote.
    const second = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_16',
        },
        {
          scannerId: 's1',
          plateIndex: '11',
          imagePath: '/scans/scan2.tif',
          assignedPlateId: 'plate_13',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(second.swaps).toEqual([]);
    expect(second.results.map((r) => r.status)).toEqual([
      'verified',
      'verified',
    ]);
    // No second correction: no GraviScan rewrite, and every assignment write
    // is a plain status update with no plate_barcode in it.
    expect(db.graviScan.update).not.toHaveBeenCalled();
    expect(db.graviScan.findFirst).not.toHaveBeenCalled();
    for (const call of db.graviScanPlateAssignment.updateMany.mock.calls) {
      expect(call[0].data).toEqual({ verification_status: 'verified' });
    }
  });

  it('scopes the GraviPlateSectionMapping lookup to the given experimentId', async () => {
    setCodes({ '/scans/scan1.tif': ['qr-1'] });
    db.graviPlateSectionMapping.findMany.mockResolvedValueOnce([
      mapping('plate_13', 'qr-1'),
    ]);

    await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
      ],
      'exp-1',
      OUTPUT_DIR
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

  it('refuses to run at all without an experimentId', async () => {
    // GraviScanPlateAssignment is unique on
    // (experiment_id, scanner_id, plate_index) and a scanner is a long-lived
    // device reused across experiments. Running unscoped would silently
    // overwrite another experiment's historical plate_barcode, so there is no
    // "unscoped fallback" mode — the run is refused instead.
    setCodes({ '/scans/scan1.tif': ['qr-1'] });

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
      ],
      '' as any,
      OUTPUT_DIR
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/experimentId/);
    expect(result.results).toEqual([]);
    expect(db.graviPlateSectionMapping.findMany).not.toHaveBeenCalled();
    expect(db.graviScanPlateAssignment.updateMany).not.toHaveBeenCalled();
    expect(mockReadQrCodesBatch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Input typing. Prisma silently DROPS a `where` key whose value is
  // `undefined`, and happily accepts a filter OBJECT (`{ not: 'zzz' }`) where
  // a scalar was intended. Either one turns a scoped `updateMany` into an
  // experiment-wide overwrite of plate_barcode/verification_status. Truthiness
  // alone does not close that hole — the values must be strings.
  // -------------------------------------------------------------------------

  it.each([
    ['a number', 123],
    ['a filter object', { not: 'zzz' }],
    ['an array', ['exp-1']],
    ['null', null],
    ['undefined', undefined],
  ])('refuses to run when experimentId is %s', async (_label, badId) => {
    setCodes({ '/scans/scan1.tif': ['qr-1'] });

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
      ],
      badId as any,
      OUTPUT_DIR
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/experimentId/);
    expect(result.results).toEqual([]);
    expect(db.graviPlateSectionMapping.findMany).not.toHaveBeenCalled();
    expect(db.graviScanPlateAssignment.updateMany).not.toHaveBeenCalled();
    expect(mockReadQrCodesBatch).not.toHaveBeenCalled();
  });

  it.each([
    ['scannerId', { scannerId: undefined }],
    ['scannerId', { scannerId: { not: 'zzz' } }],
    ['scannerId', { scannerId: '' }],
    ['plateIndex', { plateIndex: undefined }],
    ['plateIndex', { plateIndex: { not: '00' } }],
    ['plateIndex', { plateIndex: 0 }],
    ['assignedPlateId', { assignedPlateId: undefined }],
    ['assignedPlateId', { assignedPlateId: { contains: 'plate' } }],
    ['imagePath', { imagePath: undefined }],
    ['imagePath', { imagePath: { startsWith: '/scans' } }],
  ])(
    'skips a plate whose %s is not a non-empty string, without aborting the batch',
    async (_field, override) => {
      setCodes({ '/scans/good.tif': ['qr-1'] });
      db.graviPlateSectionMapping.findMany.mockResolvedValue([
        mapping('plate_13', 'qr-1'),
      ]);

      const result = await verifyPlates(
        db,
        [
          {
            scannerId: 's9',
            plateIndex: '99',
            imagePath: '/scans/bad.tif',
            assignedPlateId: 'plate_99',
            ...override,
          } as any,
          {
            scannerId: 's1',
            plateIndex: '00',
            imagePath: '/scans/good.tif',
            assignedPlateId: 'plate_13',
          },
        ],
        'exp-1',
        OUTPUT_DIR
      );

      // Per-record isolation: the malformed row is dropped, the rest of the
      // batch is verified normally.
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].scannerId).toBe('s1');
      expect(result.results[0].status).toBe('verified');
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Skipping malformed plate entry'),
        expect.anything()
      );

      // Crucially: no write may be issued for the malformed row, and no write
      // may carry a non-string scanner_id/plate_index into a `where`.
      for (const call of db.graviScanPlateAssignment.updateMany.mock.calls) {
        expect(typeof call[0].where.experiment_id).toBe('string');
        expect(typeof call[0].where.scanner_id).toBe('string');
        expect(typeof call[0].where.plate_index).toBe('string');
        expect(call[0].where.scanner_id).toBe('s1');
      }
    }
  );

  it('skips a plate entry that is not an object at all', async () => {
    setCodes({ '/scans/good.tif': ['qr-1'] });
    db.graviPlateSectionMapping.findMany.mockResolvedValue([
      mapping('plate_13', 'qr-1'),
    ]);

    const result = await verifyPlates(
      db,
      [
        null as any,
        'not-a-plate' as any,
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/good.tif',
          assignedPlateId: 'plate_13',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].scannerId).toBe('s1');
  });

  it('tolerates a non-array plates payload without throwing', async () => {
    const result = await verifyPlates(
      db,
      undefined as any,
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.success).toBe(true);
    expect(result.results).toEqual([]);
    expect(db.graviScanPlateAssignment.updateMany).not.toHaveBeenCalled();
  });

  it('scopes the verification_status write to the experimentId', async () => {
    setCodes({ '/scans/scan1.tif': ['qr-1'] });
    db.graviPlateSectionMapping.findMany.mockResolvedValueOnce([
      mapping('plate_13', 'qr-1'),
    ]);

    await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        experiment_id: 'exp-1',
        scanner_id: 's1',
        plate_index: '00',
      },
      data: { verification_status: 'verified' },
    });
  });

  it('scopes every swap-correction write and GraviScan lookup to the experimentId', async () => {
    setCodes({ '/scans/scan1.tif': ['qr-16'], '/scans/scan2.tif': ['qr-13'] });
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16')])
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13')]);
    db.graviScan.findFirst
      .mockResolvedValueOnce({ id: 'scan-1' })
      .mockResolvedValueOnce({ id: 'scan-2' });

    await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
        {
          scannerId: 's1',
          plateIndex: '11',
          imagePath: '/scans/scan2.tif',
          assignedPlateId: 'plate_16',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    // Not a single write or lookup may omit experiment_id — an unscoped one
    // can clobber a different experiment's row for the same scanner/position.
    for (const call of db.graviScanPlateAssignment.updateMany.mock.calls) {
      expect(call[0].where.experiment_id).toBe('exp-1');
    }
    for (const call of db.graviScan.findFirst.mock.calls) {
      expect(call[0].where.experiment_id).toBe('exp-1');
    }
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        experiment_id: 'exp-1',
        scanner_id: 's1',
        plate_index: '00',
      },
      data: expect.objectContaining({ plate_barcode: 'plate_16' }),
    });
    expect(db.graviScan.findFirst).toHaveBeenCalledWith({
      where: {
        experiment_id: 'exp-1',
        scanner_id: 's1',
        plate_index: '00',
        plate_barcode: 'plate_13',
        deleted: false,
      },
      orderBy: { capture_date: 'desc' },
    });
  });

  it('continues processing the batch when one verification_status write throws', async () => {
    setCodes({ '/scans/scan1.tif': ['qr-13'], '/scans/scan2.tif': ['qr-16'] });
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13')])
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16')]);

    // First updateMany call (verified plate's status write) throws; the
    // second plate's write must still be attempted.
    db.graviScanPlateAssignment.updateMany
      .mockRejectedValueOnce(new Error('DB write failed'))
      .mockResolvedValue({ count: 1 });

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
        {
          scannerId: 's1',
          plateIndex: '11',
          imagePath: '/scans/scan2.tif',
          assignedPlateId: 'plate_16',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    // The overall handler does not throw/abort — both results are present
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].status).toBe('verified');
    expect(result.results[1].status).toBe('verified');
    // The second plate's status update was still attempted despite the
    // first one throwing.
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { experiment_id: 'exp-1', scanner_id: 's1', plate_index: '11' },
      data: { verification_status: 'verified' },
    });
    expect(console.error).toHaveBeenCalledWith(
      '[GraviScan:VERIFY] Failed to update verification_status:',
      expect.any(Error)
    );
  });

  it('continues processing when a swap correction DB write throws', async () => {
    setCodes({ '/scans/scan1.tif': ['qr-16'], '/scans/scan2.tif': ['qr-13'] });
    db.graviPlateSectionMapping.findMany
      .mockResolvedValueOnce([mapping('plate_16', 'qr-16')])
      .mockResolvedValueOnce([mapping('plate_13', 'qr-13')]);

    // The first updateMany call is the swap-correction write for position1 —
    // make it throw and confirm the rest of the handler still completes.
    db.graviScanPlateAssignment.updateMany
      .mockRejectedValueOnce(new Error('swap write failed'))
      .mockResolvedValue({ count: 1 });

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
        {
          scannerId: 's1',
          plateIndex: '11',
          imagePath: '/scans/scan2.tif',
          assignedPlateId: 'plate_16',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.success).toBe(true);
    expect(result.swaps).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith(
      '[GraviScan:VERIFY] Failed to correct swap:',
      expect.any(Error)
    );
    // Final verification_status writes for both positions were still attempted
    expect(db.graviScanPlateAssignment.updateMany).toHaveBeenCalledWith({
      where: { experiment_id: 'exp-1', scanner_id: 's1', plate_index: '00' },
      data: { verification_status: 'swapped' },
    });
  });

  it('emits verify-started, verify-result (per plate), and verify-complete progress events', async () => {
    setCodes({ '/scans/scan1.tif': ['qr-1'] });
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
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
      ],
      'exp-1',
      OUTPUT_DIR,
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
    setCodes({ '/scans/scan1.tif': ['qr-1'] });
    db.graviPlateSectionMapping.findMany.mockResolvedValueOnce([
      mapping('plate_13', 'qr-1'),
    ]);

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.success).toBe(true);
  });

  it('returns a failure result if the top-level pipeline throws unexpectedly', async () => {
    mockReadQrCodesBatch.mockRejectedValueOnce(new Error('decoder exploded'));

    const result = await verifyPlates(
      db,
      [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scans/scan1.tif',
          assignedPlateId: 'plate_13',
        },
      ],
      'exp-1',
      OUTPUT_DIR
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('decoder exploded');
    expect(result.results).toEqual([]);
    expect(result.swaps).toEqual([]);
  });
});
