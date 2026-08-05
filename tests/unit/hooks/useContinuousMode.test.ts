import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useContinuousMode } from '../../../src/renderer/hooks/useContinuousMode';
import type { ScannerPanelState } from '../../../src/types/graviscan';

function scanner(
  overrides: Partial<ScannerPanelState> = {}
): ScannerPanelState {
  return {
    scannerId: 'sc-1',
    name: 'Scanner 1',
    enabled: true,
    isOnline: true,
    isBusy: false,
    state: 'idle',
    progress: 0,
    outputFilename: '',
    gridMode: '2grid',
    connectionStatus: 'ready',
    ...overrides,
  };
}

describe('useContinuousMode', () => {
  it('defaults to non-continuous, minimum interval', () => {
    const { result } = renderHook(() =>
      useContinuousMode({
        scannerStates: [scanner()],
        dpi: 1200,
        regionMm: { width: 140, height: 140 },
      })
    );
    expect(result.current.isContinuous).toBe(false);
    expect(result.current.intervalMinutes).toBeGreaterThanOrEqual(3);
  });

  it('rejects a zero-or-negative interval before it would ever reach startScan()', () => {
    const { result } = renderHook(() =>
      useContinuousMode({
        scannerStates: [scanner()],
        dpi: 1200,
        regionMm: { width: 140, height: 140 },
      })
    );

    act(() => result.current.setIntervalMinutes(0));
    expect(result.current.validate()).not.toBeNull();

    act(() => result.current.setIntervalMinutes(-5));
    expect(result.current.validate()).not.toBeNull();

    act(() => result.current.setIntervalMinutes(5));
    expect(result.current.validate()).toBeNull();
  });

  it('assembles cadenceContext with platesPerScanner from real gridMode values, not a hardcoded constant', () => {
    const { result } = renderHook(() =>
      useContinuousMode({
        scannerStates: [
          scanner({ scannerId: 'sc-1', gridMode: '2grid' }),
          scanner({ scannerId: 'sc-2', gridMode: '4grid' }),
        ],
        dpi: 1200,
        regionMm: { width: 140, height: 140 },
      })
    );

    // 4grid has more positions than 2grid — platesPerScanner should be the
    // max across assigned scanners (worst case), derived from
    // createPlateAssignments(gridMode).length, not a hardcoded 4.
    expect(result.current.cadenceContext.platesPerScanner).toBe(4);
    expect(result.current.cadenceContext.scannerCount).toBe(2);
    expect(result.current.cadenceContext.dpi).toBe(1200);
    expect(result.current.cadenceContext.regionMm).toEqual({
      width: 140,
      height: 140,
    });
  });

  it('computes platesPerScanner as 2 when every assigned scanner is 2grid', () => {
    const { result } = renderHook(() =>
      useContinuousMode({
        scannerStates: [
          scanner({ scannerId: 'sc-1', gridMode: '2grid' }),
          scanner({ scannerId: 'sc-2', gridMode: '2grid' }),
        ],
        dpi: 1200,
        regionMm: { width: 140, height: 140 },
      })
    );
    expect(result.current.cadenceContext.platesPerScanner).toBe(2);
  });
});
