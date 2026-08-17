/**
 * Unit tests: PythonStatus component (#96 + #198 + #339)
 *
 * Covers:
 * - #96: onStatus/onError listener cleanup on unmount
 * - #198: the effect body itself (not just render output) is gated on
 *   mode, since React's Rules of Hooks forbid conditionally skipping a
 *   hook call — a render-only gate would still fire the effect (and its
 *   IPC calls/subscriptions) in graviscan mode.
 * - #339: Check Hardware / Restart Python moved to Machine Configuration.
 *   Home's PythonStatus now shows only a simple Connected/Checking/Error
 *   status indicator with a generic admin-contact message on Error, and
 *   never invokes python:check-hardware or python:restart itself.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, cleanup, waitFor } from '@testing-library/react';
import { PythonStatus } from '../../../src/renderer/components/PythonStatus';

const mockOnStatusCleanup = vi.fn();
const mockOnErrorCleanup = vi.fn();

let capturedErrorCallback: (error: string) => void = () => {};

const mockPythonAPI = {
  getVersion: vi.fn().mockResolvedValue({ version: '1.0.0' }),
  checkHardware: vi.fn(),
  restart: vi.fn(),
  onStatus: vi.fn().mockReturnValue(mockOnStatusCleanup),
  onError: vi.fn().mockImplementation((cb: (error: string) => void) => {
    capturedErrorCallback = cb;
    return mockOnErrorCleanup;
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPythonAPI.getVersion.mockResolvedValue({ version: '1.0.0' });
  mockPythonAPI.onStatus.mockReturnValue(mockOnStatusCleanup);
  mockPythonAPI.onError.mockImplementation((cb: (error: string) => void) => {
    capturedErrorCallback = cb;
    return mockOnErrorCleanup;
  });

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

  it('never invokes python:check-hardware or python:restart — those actions live in Machine Configuration now', async () => {
    const { getByText } = render(<PythonStatus mode="cylinderscan" />);

    await waitFor(() => {
      expect(getByText('Python Backend Status')).toBeInTheDocument();
    });

    act(() => {
      capturedErrorCallback('Python process crashed');
    });

    await waitFor(() => {
      expect(getByText(/Contact your administrator/i)).toBeInTheDocument();
    });

    expect(mockPythonAPI.checkHardware).not.toHaveBeenCalled();
    expect(mockPythonAPI.restart).not.toHaveBeenCalled();
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

describe('PythonStatus administrator-contact messaging (#104, simplified per #339)', () => {
  it('shows a generic "Contact your administrator" message when status is Error', async () => {
    const { getByText } = render(<PythonStatus mode="cylinderscan" />);
    await waitFor(() => {
      expect(getByText('Python Backend Status')).toBeInTheDocument();
    });

    act(() => {
      capturedErrorCallback('Camera library not installed');
    });

    await waitFor(() => {
      expect(getByText(/Contact your administrator/i)).toBeInTheDocument();
    });
  });

  it('never links to Machine Configuration, regardless of status', async () => {
    const { getByText, container } = render(
      <PythonStatus mode="cylinderscan" />
    );
    await waitFor(() => {
      expect(getByText('Python Backend Status')).toBeInTheDocument();
    });

    act(() => {
      capturedErrorCallback('Camera library not installed');
    });

    await waitFor(() => {
      expect(getByText(/Contact your administrator/i)).toBeInTheDocument();
    });

    expect(
      container.querySelector('a[href*="machine-config"]')
    ).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/machine config/i);
  });
});
