import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWaveMetadataLinks } from '../../../src/renderer/hooks/useWaveMetadataLinks';

function makeLink(waveNumber: number, accessionName = 'file.xlsx') {
  return {
    wave_number: waveNumber,
    accession_id: `acc-${waveNumber}`,
    accession: { id: `acc-${waveNumber}`, name: accessionName },
  };
}

describe('useWaveMetadataLinks', () => {
  let listGraviMetadata: ReturnType<typeof vi.fn>;
  let linkGraviMetadata: ReturnType<typeof vi.fn>;
  let unlinkGraviMetadata: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listGraviMetadata = vi.fn().mockResolvedValue({ success: true, data: [] });
    linkGraviMetadata = vi.fn().mockResolvedValue({ success: true });
    unlinkGraviMetadata = vi.fn().mockResolvedValue({ success: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = global.window as any;
    win.electron.database.experiments = {
      listGraviMetadata,
      linkGraviMetadata,
      unlinkGraviMetadata,
    };
  });

  it('fetches and exposes listGraviMetadata result as links', async () => {
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [makeLink(0), makeLink(2)],
    });

    const { result } = renderHook(() => useWaveMetadataLinks('exp-1'));

    await waitFor(() => expect(result.current.links).toHaveLength(2));
    expect(listGraviMetadata).toHaveBeenCalledWith('exp-1');
  });

  it('suggestedNextWave is max(existing wave numbers) + 1', async () => {
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [makeLink(0), makeLink(2)],
    });

    const { result } = renderHook(() => useWaveMetadataLinks('exp-1'));

    await waitFor(() => expect(result.current.links).toHaveLength(2));
    expect(result.current.suggestedNextWave).toBe(3);
  });

  it('suggestedNextWave is 0 when links is empty', async () => {
    const { result } = renderHook(() => useWaveMetadataLinks('exp-1'));

    await waitFor(() => expect(listGraviMetadata).toHaveBeenCalled());
    expect(result.current.suggestedNextWave).toBe(0);
  });

  it('link() calls linkGraviMetadata and refetches links on success', async () => {
    const { result } = renderHook(() => useWaveMetadataLinks('exp-1'));
    await waitFor(() => expect(listGraviMetadata).toHaveBeenCalledTimes(1));

    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [makeLink(0)],
    });

    await act(async () => {
      await result.current.link(0, 'acc-0');
    });

    expect(linkGraviMetadata).toHaveBeenCalledWith('exp-1', 0, 'acc-0');
    expect(listGraviMetadata).toHaveBeenCalledTimes(2);
    expect(result.current.links).toHaveLength(1);
    expect(result.current.linkError).toBeNull();
  });

  it('link() sets linkError without refetching on failure', async () => {
    linkGraviMetadata.mockResolvedValue({
      success: false,
      error: 'Wave already linked',
    });
    const { result } = renderHook(() => useWaveMetadataLinks('exp-1'));
    await waitFor(() => expect(listGraviMetadata).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.link(0, 'acc-0');
    });

    expect(result.current.linkError).toBe('Wave already linked');
    expect(listGraviMetadata).toHaveBeenCalledTimes(1);
  });

  it('unlink() calls unlinkGraviMetadata and removes the entry from links on success', async () => {
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [makeLink(0), makeLink(2)],
    });
    const { result } = renderHook(() => useWaveMetadataLinks('exp-1'));
    await waitFor(() => expect(result.current.links).toHaveLength(2));

    await act(async () => {
      await result.current.unlink(0);
    });

    expect(unlinkGraviMetadata).toHaveBeenCalledWith('exp-1', 0);
    expect(result.current.links).toHaveLength(1);
    expect(result.current.links[0].wave_number).toBe(2);
  });
});
