import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWaveDates } from '../../../src/renderer/hooks/useWaveDates';
import { toIsoDate } from '../../../src/utils/wave-dates';

/** Local "YYYY-MM-DD" `n` days ago, by calendar arithmetic so DST can't shift it. */
const daysAgo = (n: number) => {
  const now = new Date();
  return toIsoDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - n)
  );
};
const wave = (n: number, sownDaysAgo: number) => ({
  id: `w${n}`,
  wave_number: n,
  dates_per_plant: false,
  germination_date: daysAgo(sownDaysAgo),
  sowing_date: daysAgo(sownDaysAgo + 3),
  transfer_date: null,
  note: null,
  set_by_name: 'Demo Phenotyper',
  set_at: '2026-01-02T09:00:00.000Z',
  scanCount: 0,
  changes: [],
  plantsWithOwnDates: [],
});
const plant = (barcode: string, germinatedDaysAgo: number) => ({
  id: `p-${barcode}`,
  wave_id: 'w1',
  plant_barcode: barcode,
  germination_date: daysAgo(germinatedDaysAgo),
  sowing_date: daysAgo(12),
  transfer_date: null,
  uses_wave_dates: false,
  reason: 'Germinated late',
  set_by_name: 'Demo Phenotyper',
  set_at: '2026-01-03T09:00:00.000Z',
  scanCount: 0,
  changes: [],
});

describe('useWaveDates', () => {
  let list: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let plants: ReturnType<typeof vi.fn>;
  let setDates: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    list = vi.fn().mockResolvedValue({ success: true, data: [wave(1, 9)] });
    create = vi.fn().mockResolvedValue({ success: true, data: wave(2, 3) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.window as any).electron.database.cylinderWaves = {
      list,
      create,
      changeDates: vi.fn(),
    };
    plants = vi
      .fn()
      .mockResolvedValue({ success: true, data: [plant('Sorghum_2', 7)] });
    setDates = vi.fn().mockResolvedValue({ success: true, data: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.window as any).electron.database.cylinderPlants = {
      list: plants,
      setDates,
      useWaveDates: vi.fn().mockResolvedValue({ success: true, data: null }),
    };
  });

  it('calculates the age from the entered wave germination date', async () => {
    const { result } = renderHook(() => useWaveDates('exp', '1', 'Sorghum_1'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.wave?.wave_number).toBe(1));
    expect(list).toHaveBeenCalledWith('exp');
    // Sorghum_1 has no row of its own: the wave's germination date.
    expect(result.current.calculatedAge).toBe(9);
    expect(result.current.plant).toBeNull();
    expect(result.current.needsWaveDates).toBe(false);
    expect(plants).toHaveBeenCalledWith('w1');
  });

  it("uses a plant's own germination date when it has one", async () => {
    const { result } = renderHook(() => useWaveDates('exp', '1', 'Sorghum_2'));
    await waitFor(() => expect(result.current.plant).not.toBeNull());
    expect(result.current.calculatedAge).toBe(7);
    expect(result.current.plantDates?.germination_date).toBe(daysAgo(7));
  });

  it("asks for a plant's dates in a per-plant wave", async () => {
    list.mockResolvedValue({
      success: true,
      data: [{ ...wave(1, 9), dates_per_plant: true, germination_date: null }],
    });
    const { result } = renderHook(() => useWaveDates('exp', '1', 'Sorghum_9'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.needsPlantDates).toBe(true);
    expect(result.current.calculatedAge).toBeNull();
  });

  it('offers "same dates for all plants" on a per-plant wave before its first scan, or when its plants share their dates', async () => {
    const perPlant = (scanCount: number) => ({
      ...wave(1, 9),
      dates_per_plant: true,
      germination_date: null,
      scanCount,
    });
    list.mockResolvedValue({ success: true, data: [perPlant(0)] });
    const { result, rerender } = renderHook(
      ({ exp }) => useWaveDates(exp, '1', 'Sorghum_2'),
      { initialProps: { exp: 'exp' } }
    );
    await waitFor(() => expect(result.current.plant).not.toBeNull());
    expect(result.current.canUseSameDates).toBe(true);
    // One plant: its dates are the shared ones.
    expect(result.current.sharedPlantDates?.germination_date).toBe(daysAgo(7));

    // Scanned, with plants on different dates: not offered.
    list.mockResolvedValue({ success: true, data: [perPlant(4)] });
    plants.mockResolvedValue({
      success: true,
      data: [plant('Sorghum_2', 7), plant('Sorghum_3', 8)],
    });
    rerender({ exp: 'exp-2' });
    await waitFor(() => expect(result.current.plant).not.toBeNull());
    expect(result.current.sharedPlantDates).toBeNull();
    expect(result.current.canUseSameDates).toBe(false);
  });

  it("saves the entered plant's dates as the phenotyper, then reloads", async () => {
    const { result } = renderHook(() =>
      useWaveDates('exp', '1', ' Sorghum_1 ', 'ph-1')
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    plants.mockClear();
    await act(async () => {
      await result.current.savePlantDates({
        germinationDate: daysAgo(8),
        sowingDate: daysAgo(12),
        reason: 'Germinated a day late',
      });
    });
    expect(setDates).toHaveBeenCalledWith({
      germinationDate: daysAgo(8),
      sowingDate: daysAgo(12),
      reason: 'Germinated a day late',
      waveId: 'w1',
      plantBarcode: 'Sorghum_1',
      phenotyperId: 'ph-1',
    });
    expect(plants).toHaveBeenCalledWith('w1');
  });

  it('asks for the germination date of a wave that has none', async () => {
    const { result } = renderHook(() => useWaveDates('exp', '2', 'Sorghum_1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.needsWaveDates).toBe(true);
    expect(result.current.calculatedAge).toBeNull();
  });

  it('asks nothing until the experiment and a valid wave are entered', async () => {
    const { result } = renderHook(() => useWaveDates('', '1', ''));
    expect(result.current.needsWaveDates).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(list).not.toHaveBeenCalled();
  });

  it('saves a new wave for the entered experiment and wave, then reloads', async () => {
    const { result } = renderHook(() => useWaveDates('exp', '2', 'Sorghum_1'));
    await waitFor(() => expect(result.current.needsWaveDates).toBe(true));
    list.mockResolvedValue({ success: true, data: [wave(1, 9), wave(2, 3)] });
    await act(async () => {
      await result.current.saveWave({
        germinationDate: daysAgo(3),
        phenotyperId: 'ph-1',
      });
    });
    expect(create).toHaveBeenCalledWith({
      germinationDate: daysAgo(3),
      phenotyperId: 'ph-1',
      experimentId: 'exp',
      waveNumber: 2,
    });
    expect(result.current.calculatedAge).toBe(3);
  });

  it('changes the entered wave date as the phenotyper, then reloads', async () => {
    const changeDates = vi.fn().mockResolvedValue({ success: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.window as any).electron.database.cylinderWaves.changeDates =
      changeDates;
    const { result } = renderHook(() =>
      useWaveDates('exp', '1', 'Sorghum_1', 'ph-1')
    );
    await waitFor(() => expect(result.current.wave).not.toBeNull());
    list.mockClear();
    await act(async () => {
      await result.current.changeDate({
        germinationDate: daysAgo(8),
        sowingDate: daysAgo(12),
      });
    });
    expect(changeDates).toHaveBeenCalledWith({
      waveId: 'w1',
      germinationDate: daysAgo(8),
      sowingDate: daysAgo(12),
      phenotyperId: 'ph-1',
    });
    expect(list).toHaveBeenCalledWith('exp');
  });

  it('reloads the waves on request', async () => {
    const { result } = renderHook(() => useWaveDates('exp', '1', 'Sorghum_1'));
    await waitFor(() => expect(result.current.wave).not.toBeNull());
    list.mockClear();
    await act(async () => {
      await result.current.reload();
    });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('reports a failed load instead of asking for a germination date', async () => {
    list.mockRejectedValue(new Error('ipc failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useWaveDates('exp', '1', 'Sorghum_1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadError).toBe('ipc failed');
    expect(result.current.needsWaveDates).toBe(false);
    expect(result.current.wave).toBeNull();
  });

  it('reports an error result from the database too', async () => {
    list.mockResolvedValue({ success: false, error: 'database is locked' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useWaveDates('exp', '1', 'Sorghum_1'));
    await waitFor(() =>
      expect(result.current.loadError).toBe('database is locked')
    );
    expect(result.current.needsWaveDates).toBe(false);
  });

  it("ignores an answer for an experiment that's no longer chosen", async () => {
    let answerA: (value: unknown) => void = () => {};
    list.mockImplementation((id: string) =>
      id === 'exp-A'
        ? new Promise((resolve) => {
            answerA = resolve;
          })
        : Promise.resolve({ success: true, data: [wave(1, 3)] })
    );
    const { result, rerender } = renderHook(
      (id: string) => useWaveDates(id, '1', 'Sorghum_1'),
      { initialProps: 'exp-A' }
    );
    rerender('exp-B');
    await waitFor(() => expect(result.current.calculatedAge).toBe(3));
    await act(async () => {
      answerA({ success: true, data: [wave(1, 9)] });
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.calculatedAge).toBe(3);
  });
});
