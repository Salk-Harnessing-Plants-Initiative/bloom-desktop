import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePhenotyperName } from '../../../src/renderer/hooks/usePhenotyperName';

describe('usePhenotyperName', () => {
  let list: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    list = vi.fn().mockResolvedValue({
      success: true,
      data: [
        { id: 'ph-1', name: 'Demo Phenotyper', email: 'a@example.com' },
        { id: 'ph-2', name: 'Second Phenotyper', email: 'b@example.com' },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.window as any).electron.database.phenotypers.list = list;
  });

  it("returns the chosen phenotyper's name", async () => {
    const { result } = renderHook(() => usePhenotyperName('ph-2'));
    await waitFor(() => expect(result.current).toBe('Second Phenotyper'));
  });

  it('returns null for no phenotyper or an unknown one', async () => {
    const { result: none } = renderHook(() => usePhenotyperName(''));
    expect(none.current).toBeNull();
    expect(list).not.toHaveBeenCalled();
    const { result: unknown } = renderHook(() => usePhenotyperName('ph-9'));
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(unknown.current).toBeNull();
  });
});
