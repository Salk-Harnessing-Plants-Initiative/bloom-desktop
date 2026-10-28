/**
 * useWaveDateFields: the plant age it puts in Capture Scan's form (#407, #428).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useState } from 'react';
import { useWaveDateFields } from '../../../src/renderer/hooks/useWaveDateFields';
import { toIsoDate } from '../../../src/utils/wave-dates';

/** Local "YYYY-MM-DD" `n` days ago, by calendar arithmetic so DST can't shift it. */
const daysAgo = (n: number) => {
  const now = new Date();
  return toIsoDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - n)
  );
};

/** Capture Scan's form, reduced to the fields the hook reads, with the age in state. */
function useForm() {
  const [plantAgeDays, setPlantAgeDays] = useState('');
  const fields = useWaveDateFields(
    {
      experimentId: 'exp',
      waveNumber: '1',
      plantQrCode: 'PLANT-001',
      phenotyper: 'ph-1',
      plantAgeDays,
    },
    setPlantAgeDays,
    false
  );
  return { plantAgeDays, setPlantAgeDays, fields };
}

describe('useWaveDateFields', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const database = (global.window as any).electron.database;
    database.cylinderWaves.list = vi.fn().mockResolvedValue({
      success: true,
      data: [
        {
          id: 'w1',
          wave_number: 1,
          dates_per_plant: false,
          germination_date: daysAgo(14),
          sowing_date: daysAgo(20),
          transfer_date: null,
          note: null,
          set_by_name: 'Demo Phenotyper',
          set_at: '2026-01-02T09:00:00.000Z',
          scanCount: 0,
          datedScanCount: 0,
          changes: [],
          plantsWithOwnDates: [],
        },
      ],
    });
    database.cylinderPlants.list = vi
      .fn()
      .mockResolvedValue({ success: true, data: [] });
  });

  it('puts the computed age back when something else replaces it in the form', async () => {
    const { result } = renderHook(() => useForm());
    await waitFor(() => expect(result.current.plantAgeDays).toBe('14'));

    // E.g. the accession lookup writing back the whole form from a copy taken before
    // the age arrived.
    act(() => result.current.setPlantAgeDays(''));
    await waitFor(() => expect(result.current.plantAgeDays).toBe('14'));

    // Or a stale age.
    act(() => result.current.setPlantAgeDays('21'));
    await waitFor(() => expect(result.current.plantAgeDays).toBe('14'));
  });
});
