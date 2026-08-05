/**
 * Unit tests: PythonStatus component (#96 + #198)
 *
 * Covers two things that both touch the same useEffect:
 * - #96: onStatus/onError listener cleanup on unmount
 * - #198: the effect body itself (not just render output) is gated on
 *   mode, since React's Rules of Hooks forbid conditionally skipping a
 *   hook call — a render-only gate would still fire the effect (and its
 *   IPC calls/subscriptions) in graviscan mode.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { PythonStatus } from '../../../src/renderer/components/PythonStatus';

const mockOnStatusCleanup = vi.fn();
const mockOnErrorCleanup = vi.fn();

const mockPythonAPI = {
  getVersion: vi.fn().mockResolvedValue({ version: '1.0.0' }),
  checkHardware: vi.fn().mockResolvedValue({
    camera: { library_available: true, devices_found: 1, available: true },
    daq: { library_available: true, devices_found: 1, available: true },
  }),
  restart: vi.fn().mockResolvedValue({ success: true }),
  onStatus: vi.fn().mockReturnValue(mockOnStatusCleanup),
  onError: vi.fn().mockReturnValue(mockOnErrorCleanup),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPythonAPI.getVersion.mockResolvedValue({ version: '1.0.0' });
  mockPythonAPI.onStatus.mockReturnValue(mockOnStatusCleanup);
  mockPythonAPI.onError.mockReturnValue(mockOnErrorCleanup);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  win.electron = {
    ...win.electron,
    python: mockPythonAPI,
  };
});

afterEach(() => {
  cleanup();
});

describe('PythonStatus — cylinderscan mode', () => {
  it('renders the heading and calls getVersion/onStatus/onError', async () => {
    const { getByText } = render(<PythonStatus mode="cylinderscan" />);

    await waitFor(() => {
      expect(getByText('Python Backend Status')).toBeInTheDocument();
    });
    expect(mockPythonAPI.getVersion).toHaveBeenCalledTimes(1);
    expect(mockPythonAPI.onStatus).toHaveBeenCalledTimes(1);
    expect(mockPythonAPI.onError).toHaveBeenCalledTimes(1);
  });

  it('invokes both cleanup functions on unmount', async () => {
    const { unmount, getByText } = render(<PythonStatus mode="cylinderscan" />);

    await waitFor(() => {
      expect(getByText('Python Backend Status')).toBeInTheDocument();
    });

    unmount();

    expect(mockOnStatusCleanup).toHaveBeenCalledTimes(1);
    expect(mockOnErrorCleanup).toHaveBeenCalledTimes(1);
  });

  it('disables the Restart Python button while a restart is in flight, so a double-click cannot fire two concurrent restarts', async () => {
    let resolveRestart: () => void;
    mockPythonAPI.restart.mockReturnValue(
      new Promise<{ success: boolean }>((resolve) => {
        resolveRestart = () => resolve({ success: true });
      })
    );

    const { getByText } = render(<PythonStatus mode="cylinderscan" />);
    await waitFor(() => {
      expect(getByText('Python Backend Status')).toBeInTheDocument();
    });

    const button = getByText('Restart Python') as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.click(button);

    await waitFor(() => {
      expect(button.disabled).toBe(true);
    });
    // A second click while disabled must not invoke restart() again.
    fireEvent.click(button);
    expect(mockPythonAPI.restart).toHaveBeenCalledTimes(1);

    resolveRestart!();

    await waitFor(() => {
      expect(button.disabled).toBe(false);
    });
  });

  it('surfaces a failed restart instead of reporting success', async () => {
    mockPythonAPI.restart.mockResolvedValue({
      success: false,
      error: 'Python executable not found',
    });

    const { getByText, queryByText } = render(
      <PythonStatus mode="cylinderscan" />
    );
    await waitFor(() => {
      expect(getByText('Python Backend Status')).toBeInTheDocument();
    });

    const button = getByText('Restart Python') as HTMLButtonElement;
    fireEvent.click(button);

    await waitFor(() => {
      expect(getByText('Python executable not found')).toBeInTheDocument();
    });

    // The button must re-enable, and "Restarted" must never be shown for a
    // failed restart — getVersion() must not be re-fetched either (only
    // the initial on-mount call should have happened), since there's no
    // reason to believe it's safe to call after a failed restart.
    expect(button.disabled).toBe(false);
    expect(queryByText('Restarted')).not.toBeInTheDocument();
    expect(mockPythonAPI.getVersion).toHaveBeenCalledTimes(1);
  });
});

describe('PythonStatus — graviscan mode', () => {
  it('renders nothing at all', () => {
    const { container } = render(<PythonStatus mode="graviscan" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('never calls getVersion/onStatus/onError — the effect body itself is gated, not just render', () => {
    render(<PythonStatus mode="graviscan" />);

    // React Testing Library's render() flushes effects synchronously via
    // act(), so by this point a mistakenly-unconditional effect would
    // already have fired.
    expect(mockPythonAPI.getVersion).not.toHaveBeenCalled();
    expect(mockPythonAPI.onStatus).not.toHaveBeenCalled();
    expect(mockPythonAPI.onError).not.toHaveBeenCalled();
  });
});
