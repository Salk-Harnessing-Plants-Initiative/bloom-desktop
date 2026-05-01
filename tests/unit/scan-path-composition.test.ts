/**
 * Tests for the GraviScan output-path composition.
 *
 * These tests pin the new behavior introduced by
 * `refactor-scan-path-from-components`: the coordinator builds the per-cycle
 * filename fresh from PlateConfig components, with no regex on file paths.
 */

import { describe, it, expect } from 'vitest';
import { composeScanFilename } from '../../src/main/scan-coordinator';
import type { PlateConfig } from '../../src/main/scanner-subprocess';

const makePlate = (overrides: Partial<PlateConfig> = {}): PlateConfig => ({
  plate_index: '001',
  grid_mode: '2grid',
  resolution: 1200,
  output_dir: '/tmp/expA_wave2_20260301T120000',
  exp_name: 'expA',
  session_timestamp: '20260301T120000',
  wave_number: 2,
  scanner_tag: 'Sc1',
  system_prefix: '',
  ...overrides,
});

describe('composeScanFilename', () => {
  it('builds the cycle-1 filename from components without any regex', () => {
    const plate = makePlate();
    expect(composeScanFilename(plate, '20260301T120000', 1)).toBe(
      'expA_wave2_st_20260301T120000_cy1_Sc1_001.tif'
    );
  });

  it('updates only the cycle segment across cycles 1, 2, 3', () => {
    const plate = makePlate();
    const ts = '20260301T120000';

    const c1 = composeScanFilename(plate, ts, 1);
    const c2 = composeScanFilename(plate, ts, 2);
    const c3 = composeScanFilename(plate, ts, 3);

    expect(c1).toBe('expA_wave2_st_20260301T120000_cy1_Sc1_001.tif');
    expect(c2).toBe('expA_wave2_st_20260301T120000_cy2_Sc1_001.tif');
    expect(c3).toBe('expA_wave2_st_20260301T120000_cy3_Sc1_001.tif');
  });

  it('embeds wave_number from PlateConfig in the filename', () => {
    expect(composeScanFilename(makePlate({ wave_number: 7 }), 'TS', 1)).toContain(
      '_wave7_'
    );
    expect(composeScanFilename(makePlate({ wave_number: 0 }), 'TS', 1)).toContain(
      '_wave0_'
    );
  });

  it('prefixes scanner_tag with the system prefix when set', () => {
    const plate = makePlate({ system_prefix: 'GS1_', scanner_tag: 'Sc2' });
    expect(composeScanFilename(plate, '20260301T120000', 4)).toBe(
      'expA_wave2_st_20260301T120000_cy4_GS1_Sc2_001.tif'
    );
  });

  it('uses the provided session timestamp argument, not a stored field', () => {
    // The first arg is the per-grid st_ timestamp computed in the coordinator
    // when the grid begins. PlateConfig.session_timestamp is for the folder
    // name; the filename gets the actual grid-start timestamp.
    const plate = makePlate({ session_timestamp: '20260301T120000' });
    const filename = composeScanFilename(plate, '20260301T120530', 1);
    expect(filename).toContain('_st_20260301T120530_');
    expect(filename).not.toContain('_st_20260301T120000_');
  });

  it('does not introduce path separators in the filename', () => {
    const filename = composeScanFilename(makePlate(), 'TS', 1);
    expect(filename).not.toContain('/');
    expect(filename).not.toContain('\\');
  });
});
