/**
 * Unit tests: useExperimentCameraSettings (#483). Capture Scan scans with the
 * checked values this hook returns, so they must always be the chosen experiment's:
 * never the previous experiment's while the new one loads, nor a late answer for it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useExperimentCameraSettings } from '../../../src/renderer/hooks/useExperimentCameraSettings';
import type { ExperimentCameraSettingsStatus } from '../../../src/types/experiment-camera-settings';
import { CHECKED_TODAY_STATUS } from '../helpers/experiment-camera-settings-mock';

function checked(exposure_time: number): ExperimentCameraSettingsStatus {
  return {
    ...CHECKED_TODAY_STATUS,
    current: { ...CHECKED_TODAY_STATUS.current!, exposure_time },
  };
}

/** A status request that answers only when told to. */
function pending() {
  let answer: (status: ExperimentCameraSettingsStatus) => void = () => {};
  const promise = new Promise<{
    success: boolean;
    data: ExperimentCameraSettingsStatus;
  }>((resolve) => {
    answer = (data) => resolve({ success: true, data });
  });
  return { promise, answer };
}

let status: ReturnType<typeof vi.fn>;

beforeEach(() => {
  status = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;
  win.electron = {
    ...win.electron,
    database: {
      ...win.electron?.database,
      experimentCameraSettings: {
        status,
        reference: vi.fn().mockResolvedValue({ success: true, data: [] }),
        history: vi.fn(),
        confirm: vi.fn(),
      },
      experiments: {
        ...win.electron?.database?.experiments,
        get: vi.fn().mockResolvedValue({ success: true, data: { name: 'X' } }),
      },
    },
  };
});

describe('useExperimentCameraSettings', () => {
  it("never returns the previous experiment's values while the next one loads, or after a late answer", async () => {
    const forA = pending();
    const forB = pending();
    status.mockImplementation((experimentId: string) =>
      experimentId === 'exp-a' ? forA.promise : forB.promise
    );
    const { result, rerender } = renderHook(
      ({ experiment }) => useExperimentCameraSettings(experiment, 'pheno-1'),
      { initialProps: { experiment: 'exp-a' } }
    );
    await act(async () => forA.answer(checked(7400)));
    await waitFor(() =>
      expect(result.current.checkedValues?.exposure_time).toBe(7400)
    );

    // Switch to B, still loading: nothing to scan with.
    rerender({ experiment: 'exp-b' });
    expect(result.current.checkedValues).toBeNull();
    expect(result.current.status).toBeNull();

    // A second, slow request for A must not land on B.
    const lateForA = pending();
    status.mockImplementation((experimentId: string) =>
      experimentId === 'exp-a' ? lateForA.promise : forB.promise
    );
    rerender({ experiment: 'exp-a' });
    rerender({ experiment: 'exp-b' });
    await act(async () => forB.answer(checked(6400)));
    await waitFor(() =>
      expect(result.current.checkedValues?.exposure_time).toBe(6400)
    );
    await act(async () => lateForA.answer(checked(7400)));
    expect(result.current.checkedValues?.exposure_time).toBe(6400);
  });
});
