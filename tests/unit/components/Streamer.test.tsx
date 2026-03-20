/**
 * Streamer component tests
 *
 * Validates the img-tag-based streaming pattern that prevents
 * the renderer OOM from unbounded Image object creation.
 */

import { render, screen, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Streamer } from '../../../src/components/Streamer';

// Type for the frame callback registered via onFrame
type FrameCallback = (image: { dataUri: string; timestamp: number }) => void;

// Mock camera API
const mockStartStream = vi.fn().mockResolvedValue({ success: true });
const mockStopStream = vi.fn().mockResolvedValue({ success: true });
const mockRemoveListener = vi.fn();
let capturedFrameCallback: FrameCallback | null = null;
const mockOnFrame = vi.fn().mockImplementation((cb: FrameCallback) => {
  capturedFrameCallback = cb;
  return mockRemoveListener;
});

beforeEach(() => {
  vi.clearAllMocks();
  capturedFrameCallback = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  if (!win.electron) win.electron = {};
  win.electron.camera = {
    startStream: mockStartStream,
    stopStream: mockStopStream,
    onFrame: mockOnFrame,
    onTrigger: vi.fn(),
    onImageCaptured: vi.fn(),
    getSettings: vi.fn().mockResolvedValue(null),
    configure: vi.fn().mockResolvedValue({ success: true }),
    getStatus: vi.fn().mockResolvedValue({ connected: false, mock: true, available: true }),
    capture: vi.fn().mockResolvedValue({ success: true }),
    connect: vi.fn().mockResolvedValue({ success: true }),
    disconnect: vi.fn().mockResolvedValue({ success: true }),
    detectCameras: vi.fn().mockResolvedValue([]),
  };
});

describe('Streamer', () => {
  it('1.1 renders img element when streaming', async () => {
    render(<Streamer />);

    // Simulate a frame arriving
    await act(async () => {
      capturedFrameCallback?.({
        dataUri: 'data:image/png;base64,abc123',
        timestamp: Date.now(),
      });
    });

    const img = screen.getByRole('img');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc123');
  });

  it('1.2 registers frame listener on mount', () => {
    render(<Streamer />);
    expect(mockOnFrame).toHaveBeenCalledTimes(1);
    expect(mockOnFrame).toHaveBeenCalledWith(expect.any(Function));
  });

  it('1.3 removes frame listener on unmount', () => {
    const { unmount } = render(<Streamer />);
    unmount();
    expect(mockRemoveListener).toHaveBeenCalledTimes(1);
  });

  it('1.4 displays latest frame only', async () => {
    render(<Streamer />);

    // Fire 10 frames rapidly
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        capturedFrameCallback?.({
          dataUri: `data:image/png;base64,frame${i}`,
          timestamp: Date.now(),
        });
      });
    }

    // img src should be the LAST frame
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'data:image/png;base64,frame9');
  });

  it('1.5 shows waiting message before first frame', () => {
    render(<Streamer />);

    // Before any frame arrives, should show connecting state
    // Both placeholder and status badge show "Connecting..."
    const elements = screen.getAllByText('Connecting...');
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it('1.6 stops stream on unmount', async () => {
    const { unmount } = render(<Streamer />);

    await act(async () => {
      unmount();
    });

    expect(mockStopStream).toHaveBeenCalledTimes(1);
  });

  it('1.7 shows FPS counter when showFps is true', async () => {
    render(<Streamer showFps={true} />);

    await act(async () => {
      capturedFrameCallback?.({
        dataUri: 'data:image/png;base64,abc',
        timestamp: Date.now(),
      });
    });

    // FPS counter shows "0 FPS" initially (updates every second)
    expect(screen.getByText(/FPS/)).toBeInTheDocument();
  });
});
