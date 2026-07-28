/**
 * Unit tests for graviscan-upload module
 *
 * Ported feature (task 6, GraviScan backend hardening): Bloom (Supabase)
 * upload re-enabled alongside Box backup. This file shipped with zero test
 * coverage on the stranded branch it was ported from — these are new,
 * written per this project's TDD discipline.
 *
 * All Supabase/network interaction is mocked. Real end-to-end upload against
 * production Supabase/Bloom requires live credentials this environment
 * doesn't have — that remains a manual verification step (see
 * task-6-report.md).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

vi.mock('@salk-hpi/bloom-js', () => ({
  SupabaseStore: vi.fn(),
  SupabaseUploader: vi.fn(),
}));

vi.mock('../../src/main/config-store', () => ({
  loadEnvConfig: vi.fn(),
}));

vi.mock('../../src/main/graviscan-path-utils', () => ({
  resolveGraviScanPath: vi.fn((p: string) => p),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn().mockResolvedValue(Buffer.from('fake-tiff-bytes')),
    },
  };
});

import { createClient } from '@supabase/supabase-js';
import { SupabaseStore, SupabaseUploader } from '@salk-hpi/bloom-js';
import { loadEnvConfig } from '../../src/main/config-store';
import { resolveGraviScanPath } from '../../src/main/graviscan-path-utils';

import { uploadAllPendingScans } from '../../src/main/graviscan-upload';

const mockCredentials = {
  scanner_mode: 'graviscan' as const,
  scanner_name: 'TestScanner',
  camera_ip_address: 'mock',
  scans_dir: '/test/scans',
  bloom_api_url: 'https://api.bloom.salk.edu/proxy',
  bloom_scanner_username: 'scanner@salk.edu',
  bloom_scanner_password: 'password123',
  bloom_anon_key: 'test-anon-key',
  num_frames: 72,
  seconds_per_rot: 7.0,
};

function makeScan(overrides: Partial<any> = {}) {
  return {
    id: overrides.id ?? 'scan-1',
    scanner: { name: 'GraviScanner1' },
    phenotyper: { name: 'Test Phenotyper', email: 'phenotyper@salk.edu' },
    experiment: {
      name: 'Test Experiment',
      species: 'arabidopsis',
      scientist: { name: 'Dr. Test', email: 'scientist@salk.edu' },
      accession: null,
    },
    plate_barcode: 'PLATE-001',
    capture_date: new Date('2026-07-01T00:00:00Z'),
    grid_mode: '2grid',
    plate_index: '00',
    resolution: 1200,
    format: 'tiff',
    cycle_number: null,
    wave_number: 0,
    session_id: null,
    session: null,
    images: [{ id: 'img-1', path: '/scans/img-1.tiff' }],
    ...overrides,
  };
}

function createMockDb() {
  return {
    graviScan: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    graviImage: {
      update: vi.fn().mockResolvedValue({}),
    },
  } as any;
}

describe('graviscan-upload', () => {
  let db: ReturnType<typeof createMockDb>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSupabaseClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockStore: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockUploader: any;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();

    (loadEnvConfig as Mock).mockReturnValue(mockCredentials);
    (resolveGraviScanPath as Mock).mockImplementation((p: string) => p);

    mockSupabaseClient = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      },
    };
    (createClient as Mock).mockReturnValue(mockSupabaseClient);

    mockStore = {
      insertGraviImageMetadata: vi
        .fn()
        .mockResolvedValue({ created: 1, error: null }),
      updateGraviImageMetadata: vi.fn().mockResolvedValue({ error: null }),
    };
    (SupabaseStore as unknown as Mock).mockImplementation(() => mockStore);

    mockUploader = {
      supabase: {
        storage: {
          from: vi.fn().mockReturnValue({
            upload: vi.fn().mockResolvedValue({ error: null }),
          }),
        },
      },
    };
    (SupabaseUploader as unknown as Mock).mockImplementation(
      () => mockUploader
    );
  });

  describe('uploadAllPendingScans — no pending work', () => {
    it('returns success with all-zero counts and never calls Supabase auth', async () => {
      db.graviScan.findMany.mockResolvedValue([]);

      const result = await uploadAllPendingScans(db);

      expect(result).toEqual({
        success: true,
        uploaded: 0,
        skipped: 0,
        failed: 0,
        errors: [],
      });
      expect(createClient).not.toHaveBeenCalled();
      expect(mockSupabaseClient.auth.signInWithPassword).not.toHaveBeenCalled();
    });
  });

  describe('uploadAllPendingScans — missing/invalid credentials', () => {
    it('returns failure without querying the DB when credentials are missing', async () => {
      (loadEnvConfig as Mock).mockReturnValue({
        ...mockCredentials,
        bloom_scanner_username: '',
        bloom_scanner_password: '',
      });

      const result = await uploadAllPendingScans(db);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Bloom credentials not found');
      expect(db.graviScan.findMany).not.toHaveBeenCalled();
      expect(createClient).not.toHaveBeenCalled();
    });

    it('returns failure without touching image/scan records when Supabase auth itself fails', async () => {
      db.graviScan.findMany.mockResolvedValue([makeScan()]);
      mockSupabaseClient.auth.signInWithPassword.mockResolvedValue({
        error: { message: 'Invalid login credentials' },
      });

      const result = await uploadAllPendingScans(db);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Authentication failed');
      expect(db.graviImage.update).not.toHaveBeenCalled();
      expect(db.graviScan.update).not.toHaveBeenCalled();
    });
  });

  describe('uploadAllPendingScans — concurrency bounding', () => {
    it('never has more than 4 image uploads in flight at once', async () => {
      const scans = Array.from({ length: 6 }, (_, i) =>
        makeScan({
          id: `scan-${i}`,
          images: [{ id: `img-${i}`, path: `/scans/img-${i}.tiff` }],
        })
      );
      db.graviScan.findMany.mockResolvedValue(scans);

      const callOrder: string[] = [];
      const resolvers: Array<() => void> = [];
      let callIndex = 0;

      mockStore.insertGraviImageMetadata.mockImplementation(() => {
        const idx = ++callIndex;
        callOrder.push(`start:${idx}`);
        return new Promise((resolve) => {
          resolvers[idx] = () => {
            callOrder.push(`end:${idx}`);
            resolve({ created: idx, error: null });
          };
        });
      });

      const resultPromise = uploadAllPendingScans(db);

      // Flush microtasks so all workers that CAN start have started.
      await new Promise((r) => setTimeout(r, 0));

      // With 6 jobs and 4 workers, exactly 4 should have started — the
      // remaining 2 are queued behind the worker pool's cursor.
      expect(callOrder.filter((c) => c.startsWith('start:'))).toHaveLength(4);

      // Finish the first in-flight call; only then should a 5th start.
      resolvers[1]();
      await new Promise((r) => setTimeout(r, 0));
      expect(callOrder.filter((c) => c.startsWith('start:'))).toHaveLength(5);

      // Finish another; only then should the 6th (last) start.
      resolvers[2]();
      await new Promise((r) => setTimeout(r, 0));
      expect(callOrder.filter((c) => c.startsWith('start:'))).toHaveLength(6);

      // All 6 jobs have now started (none queued) — resolve the rest so the
      // batch can complete.
      resolvers[3]();
      resolvers[4]();
      resolvers[5]();
      resolvers[6]();

      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(result.uploaded).toBe(6);
    });
  });

  describe('uploadAllPendingScans — per-image failure isolation', () => {
    it('marks a failed image as failed in the DB without aborting the rest of the batch', async () => {
      const scans = [
        makeScan({
          id: 'scan-1',
          images: [{ id: 'img-1', path: '/scans/1.tiff' }],
        }),
        makeScan({
          id: 'scan-2',
          images: [{ id: 'img-2', path: '/scans/2.tiff' }],
        }),
        makeScan({
          id: 'scan-3',
          images: [{ id: 'img-3', path: '/scans/3.tiff' }],
        }),
      ];
      db.graviScan.findMany.mockResolvedValue(scans);

      // insertGraviImageMetadata uses the default beforeEach mock (always
      // succeeds). Make the raw storage upload fail only for img-2's
      // generated storage path to exercise per-image failure isolation.
      // Storage paths are `gravi-images/<original-basename>_<random>.tiff` —
      // match on the basename prefix, not a raw substring, since the random
      // suffix could coincidentally contain "2" for another image.
      mockUploader.supabase.storage.from.mockReturnValue({
        upload: vi.fn().mockImplementation((storagePath: string) => {
          if (storagePath.startsWith('gravi-images/2_')) {
            return Promise.resolve({
              error: { message: 'Storage upload failed' },
            });
          }
          return Promise.resolve({ error: null });
        }),
      });

      const result = await uploadAllPendingScans(db);

      expect(result.success).toBe(false);
      expect(result.uploaded).toBe(2);
      expect(result.failed).toBe(1);
      expect(db.graviImage.update).toHaveBeenCalledWith({
        where: { id: 'img-2' },
        data: { status: 'failed' },
      });
      expect(db.graviImage.update).toHaveBeenCalledWith({
        where: { id: 'img-1' },
        data: { status: 'uploaded' },
      });
      expect(db.graviImage.update).toHaveBeenCalledWith({
        where: { id: 'img-3' },
        data: { status: 'uploaded' },
      });
    });
  });

  describe('uploadAllPendingScans — session/metadata upload capability detection', () => {
    it('does not fail the image upload when the installed bloom-js lacks insertGraviScanSession/insertGraviScanMetadata', async () => {
      // mockStore intentionally has no insertGraviScanSession/insertGraviScanMetadata
      // methods, matching the installed @salk-hpi/bloom-js@0.2.1 — this test
      // pins that the image upload still succeeds rather than being marked
      // failed just because these optional, not-yet-implemented RPCs are absent.
      const scan = makeScan({
        session_id: 'session-1',
        session: {
          scan_mode: 'single',
          interval_seconds: null,
          duration_seconds: null,
          total_cycles: null,
          started_at: new Date('2026-07-01T00:00:00Z'),
          completed_at: null,
          cancelled: false,
        },
      });
      db.graviScan.findMany.mockResolvedValue([scan]);

      const result = await uploadAllPendingScans(db);

      expect(result.success).toBe(true);
      expect(result.uploaded).toBe(1);
      expect(result.errors).toHaveLength(0);
    });
  });
});
