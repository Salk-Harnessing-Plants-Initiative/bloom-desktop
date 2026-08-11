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

/**
 * Simulates the real bug: Experiments.tsx's attach panel
 * (useWaveMetadataLinks(attachExperimentId)) and each row's
 * ExperimentWaveLinks (useWaveMetadataLinks(experiment.id)) are two
 * independent call sites for the *same* experimentId.
 */
function useTwoConsumers(experimentId: string) {
  const attachPanel = useWaveMetadataLinks(experimentId);
  const row = useWaveMetadataLinks(experimentId);
  return { attachPanel, row };
}

describe('WaveMetadataLinksProvider — cross-component sync', () => {
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

  it('linking through one consumer updates a second, independent consumer watching the same experimentId', async () => {
    const { result } = renderHook(() => useTwoConsumers('exp-1'), {
      wrapper: WaveMetadataLinksProvider,
    });

    await waitFor(() => expect(result.current.row.links).toHaveLength(0));

    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [makeLink(2)],
    });

    await act(async () => {
      await result.current.attachPanel.link(2, 'acc-2');
    });

    // The row's hook instance never called link() itself, but must see the
    // new wave because both consumers share the provider's cache for the
    // same experimentId.
    expect(result.current.row.links).toHaveLength(1);
    expect(result.current.row.links[0].wave_number).toBe(2);
  });

  it('unlinking through one consumer updates a second, independent consumer watching the same experimentId', async () => {
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [makeLink(0), makeLink(2)],
    });

    const { result } = renderHook(() => useTwoConsumers('exp-1'), {
      wrapper: WaveMetadataLinksProvider,
    });

    await waitFor(() => expect(result.current.row.links).toHaveLength(2));

    await act(async () => {
      await result.current.attachPanel.unlink(0);
    });

    expect(result.current.row.links).toHaveLength(1);
    expect(result.current.row.links[0].wave_number).toBe(2);
  });

  it('only fetches once for two consumers mounted with the same experimentId', async () => {
    renderHook(() => useTwoConsumers('exp-1'), {
      wrapper: WaveMetadataLinksProvider,
    });

    await waitFor(() => expect(listGraviMetadata).toHaveBeenCalled());
    expect(listGraviMetadata).toHaveBeenCalledTimes(1);
  });

  it('does not let a slow, stale link()-triggered refetch revert a concurrent unlink() from a different consumer', async () => {
    // The two consumers are separate UI surfaces (Experiments.tsx's attach
    // panel and a row's own Unlink button) that mutate the same
    // experimentId independently. link() re-fetches the full list after
    // its own mutation; unlink() applies a local optimistic filter with no
    // refetch. If link()'s refetch was in flight *before* unlink() applied
    // its update, the refetch's now-stale snapshot (queried before the
    // unlink took effect server-side) can land *after* unlink's update and
    // silently revert it — this test reproduces exactly that interleaving.
    listGraviMetadata.mockResolvedValueOnce({
      success: true,
      data: [makeLink(0), makeLink(1)],
    });
    const { result } = renderHook(() => useTwoConsumers('exp-1'), {
      wrapper: WaveMetadataLinksProvider,
    });
    await waitFor(() => expect(result.current.row.links).toHaveLength(2));

    let resolveStaleRefetch: (value: unknown) => void = () => {};
    // The refetch link() triggers gets this stale, pending response once;
    // if it has to retry (because it discovers it was superseded), the
    // retry hits this default instead — a fresh, correct snapshot as if
    // queried *after* both mutations have committed server-side.
    listGraviMetadata.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStaleRefetch = resolve;
        })
    );
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [makeLink(0), makeLink(2)],
    });

    // Not wrapped in act(): link() performs no synchronous state update
    // before its first await, so nothing needs flushing yet — it's left
    // pending on the not-yet-resolved refetch.
    const linkPromise = result.current.attachPanel.link(2, 'acc-2');

    await act(async () => {
      await result.current.row.unlink(1);
    });
    expect(result.current.row.links.map((l) => l.wave_number)).toEqual([0]);

    // The refetch triggered by link() resolves *after* unlink() already
    // applied, but with data queried *before* the unlink took effect
    // server-side (wave 1 still present) — a real, if unlucky, IPC
    // ordering outcome.
    await act(async () => {
      resolveStaleRefetch({
        success: true,
        data: [makeLink(0), makeLink(1), makeLink(2)],
      });
      await linkPromise;
    });

    expect(result.current.row.links.map((l) => l.wave_number).sort()).toEqual([
      0, 2,
    ]);
  });

  it('keeps two different experimentIds independent', async () => {
    listGraviMetadata.mockImplementation((id: string) =>
      Promise.resolve({
        success: true,
        data: id === 'exp-1' ? [makeLink(0)] : [makeLink(9)],
      })
    );

    function useBothExperiments() {
      const a = useWaveMetadataLinks('exp-1');
      const b = useWaveMetadataLinks('exp-2');
      return { a, b };
    }

    const { result } = renderHook(() => useBothExperiments(), {
      wrapper: WaveMetadataLinksProvider,
    });

    await waitFor(() => expect(result.current.a.links).toHaveLength(1));
    await waitFor(() => expect(result.current.b.links).toHaveLength(1));

    expect(result.current.a.links[0].wave_number).toBe(0);
    expect(result.current.b.links[0].wave_number).toBe(9);
  });
});
