import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAppMode } from '../../../src/renderer/hooks/useAppMode';

// Access the global mock set up in setup.ts
const mockGetMode = vi.fn();
const mockReload = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMode.mockResolvedValue({ mode: 'cylinderscan' });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  if (win && win.electron) {
    win.electron.config = { getMode: mockGetMode, reload: mockReload };
  }
});

describe('useAppMode', () => {
  it('returns loading state initially', () => {
    // Make getMode never resolve during this test
    mockGetMode.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAppMode());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.mode).toBeNull();
  });

  it('returns mode after IPC resolves', async () => {
    mockGetMode.mockResolvedValue({ mode: 'cylinderscan' });

    const { result } = renderHook(() => useAppMode());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.mode).toBe('cylinderscan');
  });

  it('returns graviscan when config has SCANNER_MODE=graviscan', async () => {
    mockGetMode.mockResolvedValue({ mode: 'graviscan' });

    const { result } = renderHook(() => useAppMode());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.mode).toBe('graviscan');
  });

  it("passes on a settings file that exists but can't be read, instead of a new station (#485)", async () => {
    mockGetMode.mockResolvedValue({ mode: '', loadError: 'EBUSY' });
    const { result } = renderHook(() => useAppMode());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.loadError).toBe('EBUSY');
  });

  it('reads the file again on retry, then asks for the mode again', async () => {
    mockGetMode
      .mockResolvedValueOnce({ mode: '', loadError: 'EBUSY' })
      .mockResolvedValueOnce({ mode: 'cylinderscan', loadError: null });
    mockReload.mockResolvedValue({});
    const { result } = renderHook(() => useAppMode());
    await waitFor(() => expect(result.current.loadError).toBe('EBUSY'));

    await result.current.retry();
    await waitFor(() => expect(result.current.mode).toBe('cylinderscan'));
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(result.current.loadError).toBeNull();
  });
});
