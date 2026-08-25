import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  usePlateAssignments,
  __clearPendingWritesForTests,
} from '../../../src/renderer/hooks/usePlateAssignments';

function metadataLink(waveNumber: number, accessionId: string) {
  return {
    id: `link-${waveNumber}`,
    experiment_id: 'exp-1',
    wave_number: waveNumber,
    accession_id: accessionId,
  };
}

function availablePlate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gpa-1',
    plate_id: 'Plate_01',
    accession: 'Col-0',
    transplant_date: '2026-01-01T00:00:00.000Z',
    custom_note: 'note-1',
    sections: [],
    ...overrides,
  };
}

function persistedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    experiment_id: 'exp-1',
    scanner_id: 'sc-1',
    plate_index: '00',
    plate_barcode: null,
    transplant_date: null,
    custom_note: null,
    selected: true,
    verification_status: 'pending',
    wave_number: 0,
    ...overrides,
  };
}

describe('usePlateAssignments', () => {
  let listGraviMetadata: ReturnType<typeof vi.fn>;
  let listPlateAccessions: ReturnType<typeof vi.fn>;
  let listAssignments: ReturnType<typeof vi.fn>;
  let upsertMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listGraviMetadata = vi.fn().mockResolvedValue({ success: true, data: [] });
    listPlateAccessions = vi
      .fn()
      .mockResolvedValue({ success: true, data: [] });
    listAssignments = vi.fn().mockResolvedValue({ success: true, data: [] });
    upsertMany = vi.fn().mockResolvedValue({ success: true, data: [] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = global.window as any;
    win.electron.database.experiments = {
      ...win.electron.database.experiments,
      listGraviMetadata,
    };
    win.electron.database.graviPlateAccessions = {
      list: listPlateAccessions,
    };
    win.electron.database.graviscanPlateAssignments = {
      list: listAssignments,
      upsertMany,
    };
  });

  afterEach(() => {
    // The cross-mount write-ordering guard (design.md Decision 16) is
    // deliberately module-level state — clear it so a test that triggers a
    // write without waiting for it to settle can't leak a stale entry into
    // an unrelated later test.
    __clearPendingWritesForTests();
  });

  it('no linked wave metadata: positions are empty and editable, no different-wave data leaks in', async () => {
    listGraviMetadata.mockResolvedValue({ success: true, data: [] });
    // A wave-2 row happens to exist for this scanner/position, but the
    // current wave is 3 — .list() is itself wave-scoped, so it must never
    // be returned here (PR #216 regression guard).
    listAssignments.mockResolvedValue({ success: true, data: [] });

    const { result } = renderHook(() =>
      usePlateAssignments({
        experimentId: 'exp-1',
        waveNumber: 3,
        scannerIds: ['sc-1'],
        gridModes: { 'sc-1': '2grid' },
      })
    );

    await waitFor(() =>
      expect(result.current.assignmentsByScanner['sc-1']).toBeDefined()
    );
    expect(result.current.waveMissingMetadata).toBe(true);
    expect(result.current.isGraviMetadata).toBe(false);
    const positions = result.current.assignmentsByScanner['sc-1'];
    expect(positions.every((p) => p.plantBarcode === null)).toBe(true);
    // The wave-scoped list() call itself is what guarantees no other
    // wave's data comes back — assert it was called with wave 3.
    expect(listAssignments).toHaveBeenCalledWith('exp-1', 'sc-1', 3);
  });

  it('linked metadata: auto-fill populates plantBarcode/transplantDate/customNote/selected in metadata-row order', async () => {
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [metadataLink(2, 'acc-2')],
    });
    listPlateAccessions.mockResolvedValue({
      success: true,
      data: [
        availablePlate({ plate_id: 'Plate_01' }),
        availablePlate({ plate_id: 'Plate_02' }),
      ],
    });
    listAssignments.mockResolvedValue({ success: true, data: [] });

    const { result } = renderHook(() =>
      usePlateAssignments({
        experimentId: 'exp-1',
        waveNumber: 2,
        scannerIds: ['sc-1'],
        gridModes: { 'sc-1': '2grid' },
      })
    );

    await waitFor(() =>
      expect(
        result.current.assignmentsByScanner['sc-1']?.[0]?.plantBarcode
      ).toBe('Plate_01')
    );
    expect(result.current.assignmentsByScanner['sc-1'][1].plantBarcode).toBe(
      'Plate_02'
    );
    expect(result.current.isGraviMetadata).toBe(true);
  });

  it('bootstrap case: a position with no persisted row yet is never treated as overridden', async () => {
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [metadataLink(2, 'acc-2')],
    });
    listPlateAccessions.mockResolvedValue({
      success: true,
      data: [availablePlate({ plate_id: 'Plate_01' })],
    });
    // No persisted row at all for this position.
    listAssignments.mockResolvedValue({ success: true, data: [] });

    const { result } = renderHook(() =>
      usePlateAssignments({
        experimentId: 'exp-1',
        waveNumber: 2,
        scannerIds: ['sc-1'],
        gridModes: { 'sc-1': '2grid' },
      })
    );

    await waitFor(() =>
      expect(
        result.current.assignmentsByScanner['sc-1']?.[0]?.plantBarcode
      ).toBe('Plate_01')
    );
  });

  it('a manual edit is preserved across a same-wave auto-fill re-run', async () => {
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [metadataLink(2, 'acc-2')],
    });
    listPlateAccessions.mockResolvedValue({
      success: true,
      data: [availablePlate({ plate_id: 'Plate_01' })],
    });
    // Persisted row already differs from the fresh auto-fill computation —
    // the operator changed it after a previous auto-fill.
    listAssignments.mockResolvedValue({
      success: true,
      data: [persistedRow({ plate_barcode: 'Plate_01_CORRECTED' })],
    });

    const { result } = renderHook(() =>
      usePlateAssignments({
        experimentId: 'exp-1',
        waveNumber: 2,
        scannerIds: ['sc-1'],
        gridModes: { 'sc-1': '2grid' },
      })
    );

    await waitFor(() =>
      expect(
        result.current.assignmentsByScanner['sc-1']?.[0]?.plantBarcode
      ).toBe('Plate_01_CORRECTED')
    );
  });

  it("wave-switch round-trip: switching wave and back restores the original wave's own override, not lost or re-derived", async () => {
    listGraviMetadata.mockImplementation(async () => ({
      success: true,
      data: [metadataLink(2, 'acc-2'), metadataLink(3, 'acc-3')],
    }));
    listPlateAccessions.mockImplementation(async (accessionId: string) => ({
      success: true,
      data:
        accessionId === 'acc-2'
          ? [availablePlate({ plate_id: 'Plate_WAVE2' })]
          : [availablePlate({ plate_id: 'Plate_WAVE3' })],
    }));
    listAssignments.mockImplementation(
      async (_experimentId: string, _scannerId: string, waveNumber: number) => {
        if (waveNumber === 2) {
          return {
            success: true,
            data: [
              persistedRow({ plate_barcode: 'WAVE2_OVERRIDE', wave_number: 2 }),
            ],
          };
        }
        return { success: true, data: [] };
      }
    );

    const { result, rerender } = renderHook(
      (props: { waveNumber: number }) =>
        usePlateAssignments({
          experimentId: 'exp-1',
          waveNumber: props.waveNumber,
          scannerIds: ['sc-1'],
          gridModes: { 'sc-1': '2grid' },
        }),
      { initialProps: { waveNumber: 2 } }
    );

    await waitFor(() =>
      expect(
        result.current.assignmentsByScanner['sc-1']?.[0]?.plantBarcode
      ).toBe('WAVE2_OVERRIDE')
    );

    rerender({ waveNumber: 3 });
    await waitFor(() =>
      expect(
        result.current.assignmentsByScanner['sc-1']?.[0]?.plantBarcode
      ).toBe('Plate_WAVE3')
    );

    rerender({ waveNumber: 2 });
    await waitFor(() =>
      expect(
        result.current.assignmentsByScanner['sc-1']?.[0]?.plantBarcode
      ).toBe('WAVE2_OVERRIDE')
    );
  });

  it('manually entering a barcode auto-populates matching plate metadata (PR #223 fix)', async () => {
    // The plate list an operator's manual entry can match against is
    // whatever this wave's own auto-fill lookup already loaded — seed it
    // before mount, matching how the hook actually populates it (on its
    // one data-loading effect, not mid-test with no re-fetch trigger).
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [metadataLink(0, 'acc-0')],
    });
    listPlateAccessions.mockResolvedValue({
      success: true,
      data: [
        availablePlate({
          plate_id: 'Plate_09',
          transplant_date: '2026-02-02T00:00:00.000Z',
          custom_note: 'matched-note',
        }),
      ],
    });
    listAssignments.mockResolvedValue({ success: true, data: [] });

    const { result } = renderHook(() =>
      usePlateAssignments({
        experimentId: 'exp-1',
        waveNumber: 0,
        scannerIds: ['sc-1'],
        gridModes: { 'sc-1': '2grid' },
      })
    );
    await waitFor(() =>
      expect(
        result.current.assignmentsByScanner['sc-1']?.[0]?.plantBarcode
      ).toBe('Plate_09')
    );

    // Operator manually overwrites the auto-filled barcode with the same
    // plate_id (different casing) — still expected to re-match and
    // (re)populate transplantDate/customNote from that plate's row.
    act(() => {
      result.current.updateField('sc-1', '00', 'plantBarcode', 'plate_09');
    });

    await waitFor(() =>
      expect(result.current.assignmentsByScanner['sc-1'][0].customNote).toBe(
        'matched-note'
      )
    );
    expect(result.current.assignmentsByScanner['sc-1'][0].transplantDate).toBe(
      '2026-02-02T00:00:00.000Z'
    );
  });

  it('a barcode with no match leaves transplantDate/customNote unchanged', async () => {
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [metadataLink(0, 'acc-0')],
    });
    listPlateAccessions.mockResolvedValue({
      success: true,
      data: [availablePlate({ plate_id: 'Plate_01' })],
    });
    listAssignments.mockResolvedValue({ success: true, data: [] });

    const { result } = renderHook(() =>
      usePlateAssignments({
        experimentId: 'exp-1',
        waveNumber: 0,
        scannerIds: ['sc-1'],
        gridModes: { 'sc-1': '2grid' },
      })
    );
    await waitFor(() =>
      expect(
        result.current.assignmentsByScanner['sc-1']?.[0]?.plantBarcode
      ).toBe('Plate_01')
    );

    act(() => {
      result.current.updateField('sc-1', '01', 'plantBarcode', 'no-such-plate');
    });

    await waitFor(() =>
      expect(result.current.assignmentsByScanner['sc-1'][1].plantBarcode).toBe(
        'no-such-plate'
      )
    );
    expect(
      result.current.assignmentsByScanner['sc-1'][1].transplantDate
    ).toBeNull();
    expect(
      result.current.assignmentsByScanner['sc-1'][1].customNote
    ).toBeNull();
  });

  it('surfaces an inline error and keeps the last-known state when listGraviMetadata fails', async () => {
    listGraviMetadata.mockResolvedValueOnce({
      success: true,
      data: [metadataLink(0, 'acc-0')],
    });
    listPlateAccessions.mockResolvedValueOnce({
      success: true,
      data: [availablePlate({ plate_id: 'Plate_01' })],
    });
    listAssignments.mockResolvedValue({ success: true, data: [] });

    const { result, rerender } = renderHook(
      (props: { waveNumber: number }) =>
        usePlateAssignments({
          experimentId: 'exp-1',
          waveNumber: props.waveNumber,
          scannerIds: ['sc-1'],
          gridModes: { 'sc-1': '2grid' },
        }),
      { initialProps: { waveNumber: 0 } }
    );
    await waitFor(() =>
      expect(
        result.current.assignmentsByScanner['sc-1']?.[0]?.plantBarcode
      ).toBe('Plate_01')
    );

    listGraviMetadata.mockRejectedValueOnce(new Error('IPC failure'));
    rerender({ waveNumber: 1 });

    await waitFor(() => expect(result.current.loadError).not.toBeNull());
    // Last-known state (wave 0's data) is retained, not cleared.
    expect(result.current.assignmentsByScanner['sc-1'][0].plantBarcode).toBe(
      'Plate_01'
    );
  });

  it('distinguishes a linked-but-empty accession from no link at all', async () => {
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [metadataLink(0, 'acc-empty')],
    });
    listPlateAccessions.mockResolvedValue({ success: true, data: [] });
    listAssignments.mockResolvedValue({ success: true, data: [] });

    const { result } = renderHook(() =>
      usePlateAssignments({
        experimentId: 'exp-1',
        waveNumber: 0,
        scannerIds: ['sc-1'],
        gridModes: { 'sc-1': '2grid' },
      })
    );

    await waitFor(() => expect(result.current.waveLinkedButEmpty).toBe(true));
    expect(result.current.waveMissingMetadata).toBe(false);
  });

  it('discards an out-of-order async response from an abandoned wave selection', async () => {
    let resolveWaveA: (value: unknown) => void = () => {};
    const waveAPromise = new Promise((resolve) => {
      resolveWaveA = resolve;
    });

    listGraviMetadata.mockImplementation(async () => {
      // First call (wave A) hangs until we manually resolve it, after
      // wave B's fetch has already completed.
      if (listGraviMetadata.mock.calls.length === 1) {
        await waveAPromise;
        return { success: true, data: [metadataLink(1, 'acc-A')] };
      }
      return { success: true, data: [metadataLink(2, 'acc-B')] };
    });
    listPlateAccessions.mockImplementation(async (accessionId: string) => ({
      success: true,
      data: [
        availablePlate({
          plate_id: accessionId === 'acc-A' ? 'Plate_A' : 'Plate_B',
        }),
      ],
    }));
    listAssignments.mockResolvedValue({ success: true, data: [] });

    const { result, rerender } = renderHook(
      (props: { waveNumber: number }) =>
        usePlateAssignments({
          experimentId: 'exp-1',
          waveNumber: props.waveNumber,
          scannerIds: ['sc-1'],
          gridModes: { 'sc-1': '2grid' },
        }),
      { initialProps: { waveNumber: 1 } }
    );

    // Switch to wave 2 before wave 1's fetch resolves.
    rerender({ waveNumber: 2 });
    await waitFor(() =>
      expect(
        result.current.assignmentsByScanner['sc-1']?.[0]?.plantBarcode
      ).toBe('Plate_B')
    );

    // Now let wave 1's stale fetch resolve — it must NOT overwrite wave 2's
    // already-rendered state.
    resolveWaveA(undefined);
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.assignmentsByScanner['sc-1'][0].plantBarcode).toBe(
      'Plate_B'
    );
  });

  it('a manually-entered barcode (no metadata link) survives a genuine unmount+remount, not just a same-instance rerender', async () => {
    // Stateful mock: upsertMany() actually records what gets written, and
    // listAssignments() actually reads it back — a real unmount/remount
    // has no living hook instance to keep local state in, so the ONLY
    // thing a fresh mount can possibly see is whatever was truly
    // persisted, exactly like the real IPC/DB round-trip.
    let storedRow: Record<string, unknown> | null = null;
    listGraviMetadata.mockResolvedValue({ success: true, data: [] });
    listAssignments.mockImplementation(async () => ({
      success: true,
      data: storedRow ? [storedRow] : [],
    }));
    upsertMany.mockImplementation(
      async (
        _experimentId: string,
        _scannerId: string,
        assignments: Array<Record<string, unknown>>
      ) => {
        storedRow = {
          id: 'row-1',
          experiment_id: 'exp-1',
          scanner_id: 'sc-1',
          wave_number: 0,
          verification_status: 'pending',
          ...assignments[0],
        };
        return { success: true, data: [storedRow] };
      }
    );

    const first = renderHook(() =>
      usePlateAssignments({
        experimentId: 'exp-1',
        waveNumber: 0,
        scannerIds: ['sc-1'],
        gridModes: { 'sc-1': '2grid' },
      })
    );
    await waitFor(() =>
      expect(first.result.current.assignmentsByScanner['sc-1']).toBeDefined()
    );

    act(() => {
      first.result.current.updateField(
        'sc-1',
        '00',
        'plantBarcode',
        'MANUAL_PLATE'
      );
    });
    // Wait for the write (persistPosition's upsertMany) to actually land,
    // matching a real operator who waits a beat before navigating away.
    await waitFor(() => expect(upsertMany).toHaveBeenCalled());
    await waitFor(() => expect(storedRow).not.toBeNull());

    // Simulate navigating away and back: the old GraviScan.tsx tree (and
    // this hook instance with it) is fully torn down, not just re-rendered
    // with new props.
    first.unmount();

    const second = renderHook(() =>
      usePlateAssignments({
        experimentId: 'exp-1',
        waveNumber: 0,
        scannerIds: ['sc-1'],
        gridModes: { 'sc-1': '2grid' },
      })
    );

    await waitFor(() =>
      expect(
        second.result.current.assignmentsByScanner['sc-1']?.[0]?.plantBarcode
      ).toBe('MANUAL_PLATE')
    );
  });

  it('a manually-entered barcode survives unmount+remount even if its write is still in flight at unmount time (regression: persistPosition() was fire-and-forget with no cross-mount write-ordering guard, review-pr round 5)', async () => {
    let storedRow: Record<string, unknown> | null = null;
    const pendingResolvers: Array<() => void> = [];
    listGraviMetadata.mockResolvedValue({ success: true, data: [] });
    listAssignments.mockImplementation(async () => ({
      success: true,
      data: storedRow ? [storedRow] : [],
    }));
    upsertMany.mockImplementation(
      (
        _experimentId: string,
        _scannerId: string,
        assignments: Array<Record<string, unknown>>
      ) =>
        new Promise((resolve) => {
          pendingResolvers.push(() => {
            storedRow = {
              id: 'row-1',
              experiment_id: 'exp-1',
              scanner_id: 'sc-1',
              wave_number: 0,
              verification_status: 'pending',
              ...assignments[0],
            };
            resolve({ success: true, data: [storedRow] });
          });
        })
    );

    const first = renderHook(() =>
      usePlateAssignments({
        experimentId: 'exp-1',
        waveNumber: 0,
        scannerIds: ['sc-1'],
        gridModes: { 'sc-1': '2grid' },
      })
    );
    await waitFor(() =>
      expect(first.result.current.assignmentsByScanner['sc-1']).toBeDefined()
    );
    // Let the mount's own write-through of the blank baseline (no linked
    // metadata, no persisted row yet) settle first, so only the edit's own
    // write is left pending below.
    await waitFor(() => expect(pendingResolvers).toHaveLength(1));
    await act(async () => {
      pendingResolvers[0]();
    });
    await waitFor(() => expect(storedRow).not.toBeNull());

    act(() => {
      first.result.current.updateField(
        'sc-1',
        '00',
        'plantBarcode',
        'MANUAL_PLATE'
      );
    });
    await waitFor(() => expect(pendingResolvers).toHaveLength(2));

    // Unmount WHILE the edit's write is still unresolved — the operator
    // navigated away faster than the IPC/DB round-trip completed.
    first.unmount();

    const listCallsBeforeSecondMount = listAssignments.mock.calls.length;
    const second = renderHook(() =>
      usePlateAssignments({
        experimentId: 'exp-1',
        waveNumber: 0,
        scannerIds: ['sc-1'],
        gridModes: { 'sc-1': '2grid' },
      })
    );

    // Flush pending microtasks so the fresh mount's load effect has every
    // chance to reach its own list() call — but the edit's write is still
    // unresolved, so it must be genuinely blocked awaiting it, not already
    // past it. Without this assertion, a test that immediately resolves
    // the write (as an earlier version of this test did) can pass on the
    // UN-fixed code too, since the read would just happen to see the
    // already-updated mock state — proving nothing about ordering.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(listAssignments.mock.calls.length).toBe(listCallsBeforeSecondMount);

    // Only now does the edit's original write actually land.
    pendingResolvers[1]();

    await waitFor(() =>
      expect(
        second.result.current.assignmentsByScanner['sc-1']?.[0]?.plantBarcode
      ).toBe('MANUAL_PLATE')
    );
  });

  it('two rapid edits to the SAME position never fire concurrent writes — the second is enqueued behind the first, not raced (regression: registerPendingWrite tracked only the last-registered write per key, so an older write could commit after a newer one with no protection, review-pr round 5)', async () => {
    listGraviMetadata.mockResolvedValue({ success: true, data: [] });
    listAssignments.mockResolvedValue({ success: true, data: [] });

    const startedFor: Array<string | null> = [];
    const resolvers: Array<() => void> = [];
    upsertMany.mockImplementation(
      (
        _experimentId: string,
        _scannerId: string,
        assignments: Array<Record<string, unknown>>
      ) => {
        startedFor.push((assignments[0]?.plate_barcode as string) ?? null);
        return new Promise((resolve) => {
          resolvers.push(() => resolve({ success: true, data: [] }));
        });
      }
    );

    const { result } = renderHook(() =>
      usePlateAssignments({
        experimentId: 'exp-1',
        waveNumber: 0,
        scannerIds: ['sc-1'],
        gridModes: { 'sc-1': '2grid' },
      })
    );
    await waitFor(() =>
      expect(result.current.assignmentsByScanner['sc-1']).toBeDefined()
    );
    // Settle the mount's own write-through of the blank baseline so it
    // doesn't interfere with what's being tested below.
    await waitFor(() => expect(resolvers).toHaveLength(1));
    await act(async () => {
      resolvers[0]();
    });

    act(() => {
      result.current.updateField('sc-1', '00', 'plantBarcode', 'FIRST');
    });
    await waitFor(() => expect(resolvers).toHaveLength(2));
    expect(startedFor[1]).toBe('FIRST');

    act(() => {
      result.current.updateField('sc-1', '00', 'plantBarcode', 'SECOND');
    });

    // The second edit's write must NOT start until the first one settles —
    // enqueueWrite() serializes writes to the same position instead of
    // firing them concurrently with no guaranteed commit order.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(resolvers).toHaveLength(2);

    // Resolving the first write unblocks the second, now-enqueued one.
    await act(async () => {
      resolvers[1]();
    });
    await waitFor(() => expect(resolvers).toHaveLength(3));
    expect(startedFor[2]).toBe('SECOND');

    await act(async () => {
      resolvers[2]();
    });
  });

  // ── Regression found by review-pr round 1 ───────────────────────────────

  it('a failed upsertMany() from an operator edit surfaces via saveError instead of failing silently', async () => {
    listGraviMetadata.mockResolvedValue({ success: true, data: [] });
    listAssignments.mockResolvedValue({ success: true, data: [] });
    upsertMany.mockResolvedValue({ success: false, error: 'db locked' });

    const { result } = renderHook(() =>
      usePlateAssignments({
        experimentId: 'exp-1',
        waveNumber: 0,
        scannerIds: ['sc-1'],
        gridModes: { 'sc-1': '2grid' },
      })
    );
    await waitFor(() =>
      expect(result.current.assignmentsByScanner['sc-1']).toBeDefined()
    );

    act(() => {
      result.current.updateField('sc-1', '00', 'plantBarcode', 'PLATE_099');
    });

    await waitFor(() => expect(result.current.saveError).toMatch(/db locked/));
  });

  it('an upsertMany() promise rejection also surfaces via saveError', async () => {
    listGraviMetadata.mockResolvedValue({ success: true, data: [] });
    listAssignments.mockResolvedValue({ success: true, data: [] });
    upsertMany.mockRejectedValue(new Error('IPC bridge closed'));

    const { result } = renderHook(() =>
      usePlateAssignments({
        experimentId: 'exp-1',
        waveNumber: 0,
        scannerIds: ['sc-1'],
        gridModes: { 'sc-1': '2grid' },
      })
    );
    await waitFor(() =>
      expect(result.current.assignmentsByScanner['sc-1']).toBeDefined()
    );

    act(() => {
      result.current.toggleSelected('sc-1', '00');
    });

    await waitFor(() =>
      expect(result.current.saveError).toMatch(/IPC bridge closed/)
    );
  });
});
