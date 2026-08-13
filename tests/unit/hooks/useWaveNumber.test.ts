import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWaveNumber } from '../../../src/renderer/hooks/useWaveNumber';

describe('useWaveNumber', () => {
  let getMaxWaveNumber: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getMaxWaveNumber = vi.fn().mockResolvedValue({ success: true, data: -1 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.window as any).electron.database.graviscans = {
      getMaxWaveNumber,
    };
  });

  it('defaults waveNumber to 0', async () => {
    const { result } = renderHook(() => useWaveNumber('exp-1'));
    expect(result.current.waveNumber).toBe(0);
    await waitFor(() => expect(getMaxWaveNumber).toHaveBeenCalled());
  });

  it('reads and sets the selected wave number, including 0', async () => {
    const { result } = renderHook(() => useWaveNumber('exp-1'));
    await waitFor(() => expect(getMaxWaveNumber).toHaveBeenCalled());

    act(() => result.current.setWaveNumber(3));
    expect(result.current.waveNumber).toBe(3);

    act(() => result.current.setWaveNumber(0));
    expect(result.current.waveNumber).toBe(0);
  });

  it('rejects negative input, leaving the wave number unchanged', async () => {
    const { result } = renderHook(() => useWaveNumber('exp-1'));
    await waitFor(() => expect(getMaxWaveNumber).toHaveBeenCalled());

    act(() => result.current.setWaveNumber(2));
    expect(result.current.waveNumber).toBe(2);

    act(() => result.current.setWaveNumber(-1));
    expect(result.current.waveNumber).toBe(2);
  });

  it('surfaces a suggested next wave of getMaxWaveNumber() + 1', async () => {
    getMaxWaveNumber.mockResolvedValue({ success: true, data: 4 });
    const { result } = renderHook(() => useWaveNumber('exp-1'));

    await waitFor(() => expect(result.current.suggestedNextWave).toBe(5));
  });

  it('suggests wave 0 as the next wave for an experiment with no scans yet', async () => {
    getMaxWaveNumber.mockResolvedValue({ success: true, data: -1 });
    const { result } = renderHook(() => useWaveNumber('exp-1'));

    await waitFor(() => expect(result.current.suggestedNextWave).toBe(0));
  });
});
