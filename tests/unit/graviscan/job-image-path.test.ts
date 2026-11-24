// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { recordJobImagePath } from '../../../src/main/graviscan/job-image-path';
import type {
  ScanSessionJob,
  ScanSessionState,
} from '../../../src/types/graviscan';

const SESSION_DIR = path.join(
  '/scans',
  'Perceptome_Screen_wave20_20260809T190946'
);
const PLANNED = path.join(
  SESSION_DIR,
  'Perceptome_Screen_wave20_st_20260809T190946_cy1_graviscan-desktop_Sc1_00.tif'
);
const SAVED = path.join(
  SESSION_DIR,
  'Perceptome_Screen_wave20_st_20260809T191127_et_20260809T191210_cy1_graviscan-desktop_Sc1_00.tif'
);

function job(overrides: Partial<ScanSessionJob> = {}): ScanSessionJob {
  return {
    scannerId: 'scanner-a',
    plateIndex: '00',
    outputPath: PLANNED,
    plantBarcode: null,
    transplantDate: null,
    customNote: null,
    gridMode: '4grid',
    status: 'pending',
    ...overrides,
  };
}

function session(jobs: Record<string, ScanSessionJob>): ScanSessionState {
  return { jobs } as unknown as ScanSessionState;
}

describe('recordJobImagePath', () => {
  it('keeps the real saved path (with _et_) on the job, so a remounted page restores it', () => {
    const s = session({ 'scanner-a:00': job() });
    recordJobImagePath(() => s, {
      scanner_id: 'scanner-a',
      plate_index: '00',
      path: SAVED,
    });
    expect(s.jobs['scanner-a:00'].imagePath).toBe(SAVED);
    // The planned path is left as it was.
    expect(s.jobs['scanner-a:00'].outputPath).toBe(PLANNED);
  });

  it('accepts the camelCase event fields too', () => {
    const s = session({ 'scanner-a:00': job() });
    recordJobImagePath(() => s, {
      scannerId: 'scanner-a',
      plateIndex: '00',
      path: SAVED,
    });
    expect(s.jobs['scanner-a:00'].imagePath).toBe(SAVED);
  });

  it('ignores a file from another session folder (a late file from an earlier session)', () => {
    const s = session({ 'scanner-a:00': job() });
    recordJobImagePath(() => s, {
      scanner_id: 'scanner-a',
      plate_index: '00',
      path: path.join(
        '/scans',
        'Perceptome_Screen_wave20_20260809T180000',
        'Perceptome_Screen_wave20_st_20260809T180000_et_20260809T180100_cy1_graviscan-desktop_Sc1_00.tif'
      ),
    });
    expect(s.jobs['scanner-a:00'].imagePath).toBeUndefined();
  });

  it('ignores an event for a plate that is not a job of this session', () => {
    const s = session({ 'scanner-a:00': job() });
    recordJobImagePath(() => s, {
      scanner_id: 'scanner-b',
      plate_index: '00',
      path: SAVED,
    });
    expect(s.jobs['scanner-a:00'].imagePath).toBeUndefined();
    expect(Object.keys(s.jobs)).toEqual(['scanner-a:00']);
  });

  it('never writes through an inherited key such as __proto__', () => {
    const s = session({ 'scanner-a:00': job() });
    recordJobImagePath(() => s, {
      scanner_id: '__proto__',
      plate_index: '',
      path: SAVED,
    });
    recordJobImagePath(() => s, {
      scanner_id: 'constructor',
      plate_index: '',
      path: SAVED,
    });
    expect(({} as Record<string, unknown>).imagePath).toBeUndefined();
  });

  it('does nothing without a session or without a path', () => {
    expect(() =>
      recordJobImagePath(() => null, {
        scanner_id: 'scanner-a',
        plate_index: '00',
        path: SAVED,
      })
    ).not.toThrow();
    const s = session({ 'scanner-a:00': job() });
    recordJobImagePath(() => s, { scanner_id: 'scanner-a', plate_index: '00' });
    expect(s.jobs['scanner-a:00'].imagePath).toBeUndefined();
  });

  it('keeps the latest file of a continuous session', () => {
    const s = session({ 'scanner-a:00': job() });
    const cycle2 = SAVED.replace('_cy1_', '_cy2_');
    recordJobImagePath(() => s, {
      scanner_id: 'scanner-a',
      plate_index: '00',
      path: SAVED,
    });
    recordJobImagePath(() => s, {
      scanner_id: 'scanner-a',
      plate_index: '00',
      path: cycle2,
    });
    expect(s.jobs['scanner-a:00'].imagePath).toBe(cycle2);
  });
});
