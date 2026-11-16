import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBloomConnected } from '../../../src/renderer/hooks/useBloomConnected';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const win = global.window as any;

describe('useBloomConnected', () => {
  beforeEach(() => {
    win.electron = { ...win.electron, config: {} };
  });

  it('is connected when the config has no bloom_not_connected', async () => {
    const get = vi.fn().mockResolvedValue({ config: {} });
    win.electron.config = { get };
    const { result } = renderHook(() => useBloomConnected());
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(result.current).toBe(true);
  });

  it('turns off once the config says bloom_not_connected', async () => {
    win.electron.config = {
      get: vi.fn().mockResolvedValue({ config: { bloom_not_connected: true } }),
    };
    const { result } = renderHook(() => useBloomConnected());
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('stays connected when the config cannot be read', async () => {
    const get = vi.fn().mockRejectedValue(new Error('no config'));
    win.electron.config = { get };
    const { result } = renderHook(() => useBloomConnected());
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(result.current).toBe(true);
  });
});
