import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWaveSowingDate } from '../../../src/renderer/hooks/useWaveSowingDate';
import { toIsoDate } from '../../../src/utils/sowing-date';

const daysAgo = (n: number) => toIsoDate(new Date(Date.now() - n * 86_400_000));
const wave = (n: number, sownDaysAgo: number) => ({
  id: `w${n}`,
  wave_number: n,
  sowing_date: daysAgo(sownDaysAgo),
  note: null,
  set_by_name: 'Demo Phenotyper',
  set_at: '2026-01-02T09:00:00.000Z',
  scanCount: 0,
});

describe('useWaveSowingDate', () => {
  let list: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    list = vi.fn().mockResolvedValue({ success: true, data: [wave(1, 9)] });
    create = vi.fn().mockResolvedValue({ success: true, data: wave(2, 3) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.window as any).electron.database.cylinderWaves = {
      list,
      create,
      changeSowingDate: vi.fn(),
    };
  });

  it('calculates the age from the entered wave sowing date', async () => {
    const { result } = renderHook(() =>
      useWaveSowingDate('exp', '1', 'Daisy_1')
    );
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.wave?.wave_number).toBe(1));
    expect(list).toHaveBeenCalledWith('exp');
    expect(result.current.calculatedAge).toBe(9);
    expect(result.current.ageToUse).toBe(9);
    expect(result.current.needsSowingDate).toBe(false);
  });

  it('asks for the sowing date of a wave that has none', async () => {
    const { result } = renderHook(() =>
      useWaveSowingDate('exp', '2', 'Daisy_1')
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.needsSowingDate).toBe(true);
    expect(result.current.calculatedAge).toBeNull();
  });

  it('asks nothing until the experiment and a valid wave are entered', async () => {
    const { result } = renderHook(() => useWaveSowingDate('', '1', ''));
    expect(result.current.needsSowingDate).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(list).not.toHaveBeenCalled();
  });

  it('uses a changed age for one plant only', async () => {
    const { result, rerender } = renderHook(
      (props) => useWaveSowingDate(...props),
      {
        initialProps: ['exp', '1', 'Daisy_1'] as [string, string, string],
      }
    );
    await waitFor(() => expect(result.current.calculatedAge).toBe(9));
    act(() =>
      result.current.setChange({ age: 8, reason: 'Experiment was sown later' })
    );
    expect(result.current.ageToUse).toBe(8);
    rerender(['exp', '1', 'Daisy_2']);
    await waitFor(() => expect(result.current.change).toBeNull());
    expect(result.current.ageToUse).toBe(9);
  });

  it('drops a changed age when the phenotyper changes', async () => {
    const { result, rerender } = renderHook(
      (props) => useWaveSowingDate(...props),
      {
        initialProps: ['exp', '1', 'Daisy_1', 'ph-1'] as [
          string,
          string,
          string,
          string,
        ],
      }
    );
    await waitFor(() => expect(result.current.calculatedAge).toBe(9));
    act(() =>
      result.current.setChange({ age: 8, reason: 'Experiment was sown later' })
    );
    rerender(['exp', '1', 'Daisy_1', 'ph-2']);
    await waitFor(() => expect(result.current.change).toBeNull());
  });

  it('saves a new wave for the entered experiment and wave, then reloads', async () => {
    const { result } = renderHook(() =>
      useWaveSowingDate('exp', '2', 'Daisy_1')
    );
    await waitFor(() => expect(result.current.needsSowingDate).toBe(true));
    list.mockResolvedValue({ success: true, data: [wave(1, 9), wave(2, 3)] });
    await act(async () => {
      await result.current.saveWave({
        sowingDate: daysAgo(3),
        phenotyperId: 'ph-1',
      });
    });
    expect(create).toHaveBeenCalledWith({
      sowingDate: daysAgo(3),
      phenotyperId: 'ph-1',
      experimentId: 'exp',
      waveNumber: 2,
    });
    expect(result.current.calculatedAge).toBe(3);
  });

  it('changes the entered wave date as the phenotyper, then reloads', async () => {
    const changeSowingDate = vi.fn().mockResolvedValue({ success: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.window as any).electron.database.cylinderWaves.changeSowingDate =
      changeSowingDate;
    const { result } = renderHook(() =>
      useWaveSowingDate('exp', '1', 'Daisy_1', 'ph-1')
    );
    await waitFor(() => expect(result.current.wave).not.toBeNull());
    list.mockClear();
    await act(async () => {
      await result.current.changeDate(daysAgo(8));
    });
    expect(changeSowingDate).toHaveBeenCalledWith({
      waveId: 'w1',
      sowingDate: daysAgo(8),
      reason: undefined,
      phenotyperId: 'ph-1',
    });
    expect(list).toHaveBeenCalledWith('exp');
  });

  it('reloads the waves on request', async () => {
    const { result } = renderHook(() =>
      useWaveSowingDate('exp', '1', 'Daisy_1')
    );
    await waitFor(() => expect(result.current.wave).not.toBeNull());
    list.mockClear();
    await act(async () => {
      await result.current.reload();
    });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('asks for the sowing date when the waves cannot be loaded', async () => {
    list.mockRejectedValue(new Error('ipc failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useWaveSowingDate('exp', '1', 'Daisy_1')
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.needsSowingDate).toBe(true);
  });
});
