import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWaveMetadataLinks } from '../../../src/renderer/hooks/useWaveMetadataLinks';
import { WaveMetadataLinksProvider } from '../../../src/renderer/contexts/WaveMetadataLinksContext';

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

    const { result } = renderHook(() => useWaveMetadataLinks('exp-1'), {
      wrapper: WaveMetadataLinksProvider,
    });

    await waitFor(() => expect(result.current.links).toHaveLength(2));
    expect(listGraviMetadata).toHaveBeenCalledWith('exp-1');
  });

  it('suggestedNextWave is max(existing wave numbers) + 1', async () => {
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [makeLink(0), makeLink(2)],
    });

    const { result } = renderHook(() => useWaveMetadataLinks('exp-1'), {
      wrapper: WaveMetadataLinksProvider,
    });

    await waitFor(() => expect(result.current.links).toHaveLength(2));
    expect(result.current.suggestedNextWave).toBe(3);
  });

  it('suggestedNextWave is 0 when links is empty', async () => {
    const { result } = renderHook(() => useWaveMetadataLinks('exp-1'), {
      wrapper: WaveMetadataLinksProvider,
    });

    await waitFor(() => expect(listGraviMetadata).toHaveBeenCalled());
    expect(result.current.suggestedNextWave).toBe(0);
  });

  it('link() calls linkGraviMetadata and refetches links on success', async () => {
    const { result } = renderHook(() => useWaveMetadataLinks('exp-1'), {
      wrapper: WaveMetadataLinksProvider,
    });
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
    const { result } = renderHook(() => useWaveMetadataLinks('exp-1'), {
      wrapper: WaveMetadataLinksProvider,
    });
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
    const { result } = renderHook(() => useWaveMetadataLinks('exp-1'), {
      wrapper: WaveMetadataLinksProvider,
    });
    await waitFor(() => expect(result.current.links).toHaveLength(2));

    await act(async () => {
      await result.current.unlink(0);
    });

    expect(unlinkGraviMetadata).toHaveBeenCalledWith('exp-1', 0);
    expect(result.current.links).toHaveLength(1);
    expect(result.current.links[0].wave_number).toBe(2);
  });

  it('unlink() sets linkError and keeps the entry in links on failure', async () => {
    unlinkGraviMetadata.mockResolvedValue({
      success: false,
      error: 'Nothing to unlink',
    });
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [makeLink(0)],
    });
    const { result } = renderHook(() => useWaveMetadataLinks('exp-1'), {
      wrapper: WaveMetadataLinksProvider,
    });
    await waitFor(() => expect(result.current.links).toHaveLength(1));

    await act(async () => {
      await result.current.unlink(0);
    });

    expect(result.current.linkError).toBe('Nothing to unlink');
    expect(result.current.links).toHaveLength(1);
  });

  it('link() resolves true on success and false on failure', async () => {
    const { result } = renderHook(() => useWaveMetadataLinks('exp-1'), {
      wrapper: WaveMetadataLinksProvider,
    });
    await waitFor(() => expect(listGraviMetadata).toHaveBeenCalledTimes(1));

    let linkResult: boolean | undefined;
    await act(async () => {
      linkResult = await result.current.link(0, 'acc-0');
    });
    expect(linkResult).toBe(true);

    linkGraviMetadata.mockResolvedValue({
      success: false,
      error: 'Wave already linked',
    });
    await act(async () => {
      linkResult = await result.current.link(0, 'acc-0');
    });
    expect(linkResult).toBe(false);
  });

  it('unlink() resolves true on success and false on failure', async () => {
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [makeLink(0)],
    });
    const { result } = renderHook(() => useWaveMetadataLinks('exp-1'), {
      wrapper: WaveMetadataLinksProvider,
    });
    await waitFor(() => expect(result.current.links).toHaveLength(1));

    unlinkGraviMetadata.mockResolvedValue({ success: false, error: 'nope' });
    let unlinkResult: boolean | undefined;
    await act(async () => {
      unlinkResult = await result.current.unlink(0);
    });
    expect(unlinkResult).toBe(false);

    unlinkGraviMetadata.mockResolvedValue({ success: true });
    await act(async () => {
      unlinkResult = await result.current.unlink(0);
    });
    expect(unlinkResult).toBe(true);
  });

  // Note: this only exercises two *different* experimentId keys, which
  // can't clobber each other regardless of any staleness guard (the
  // context state is keyed per experimentId). The actual at-risk race —
  // two consumers mutating the *same* experimentId concurrently, e.g. the
  // attach panel's link() and a row's own unlink() — is covered in
  // tests/unit/contexts/WaveMetadataLinksContext.test.tsx instead.
  it('ignores a stale refetch response after experimentId changes', async () => {
    const resolvers: Record<
      string,
      (v: { success: true; data: unknown[] }) => void
    > = {};
    listGraviMetadata.mockImplementation(
      (id: string) =>
        new Promise((resolve) => {
          resolvers[id] = resolve;
        })
    );

    const { result, rerender } = renderHook(
      ({ experimentId }) => useWaveMetadataLinks(experimentId),
      {
        initialProps: { experimentId: 'exp-1' },
        wrapper: WaveMetadataLinksProvider,
      }
    );

    rerender({ experimentId: 'exp-2' });

    // Resolve the stale exp-1 request after the hook has already moved on
    // to exp-2 — it must not overwrite exp-2's (still-pending) data.
    await act(async () => {
      resolvers['exp-1']({ success: true, data: [makeLink(9)] });
      await Promise.resolve();
    });

    expect(result.current.links).toHaveLength(0);

    await act(async () => {
      resolvers['exp-2']({ success: true, data: [makeLink(1)] });
      await Promise.resolve();
    });

    expect(result.current.links).toHaveLength(1);
    expect(result.current.links[0].wave_number).toBe(1);
  });
});
