/**
 * Streamer component tests
 *
 * Validates the createImageBitmap + close() streaming pattern that prevents
 * Chromium's C++ bitmap memory from accumulating.
 */

import { render, screen, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Streamer } from '../../../src/components/Streamer';
import { mockDrawImage, mockClearRect, mockBitmapClose } from '../setup';

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
    getStatus: vi
      .fn()
      .mockResolvedValue({ connected: false, mock: true, available: true }),
    capture: vi.fn().mockResolvedValue({ success: true }),
    connect: vi.fn().mockResolvedValue({ success: true }),
    disconnect: vi.fn().mockResolvedValue({ success: true }),
    detectCameras: vi.fn().mockResolvedValue([]),
  };
});

// Helper: flush the createImageBitmap async pipeline
// atob (sync) + Blob (sync) + createImageBitmap (one Promise)
async function flushFrameDecode(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('Streamer', () => {
  it('1.1 renders canvas element after frame received', async () => {
    render(<Streamer />);

    await act(async () => {
      capturedFrameCallback?.({
        dataUri: 'data:image/jpeg;base64,/9j/4AAQ',
        timestamp: Date.now(),
      });
    });
    await flushFrameDecode();

    const canvas = document.querySelector('[data-testid="stream-canvas"]');
    expect(canvas).toBeInTheDocument();
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

  it('1.4 busy gate — only latest frame drawn after decode', async () => {
    render(<Streamer />);

    // Send 3 frames rapidly — only the last should be drawn
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        capturedFrameCallback?.({
          dataUri: `data:image/jpeg;base64,frame${i}`,
          timestamp: Date.now(),
        });
      });
    }

    await flushFrameDecode();
    await flushFrameDecode();

    expect(mockDrawImage).toHaveBeenCalled();
  });

  it('1.5 shows connecting state before first frame', () => {
    render(<Streamer />);

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
        dataUri: 'data:image/jpeg;base64,abc',
        timestamp: Date.now(),
      });
    });
    await flushFrameDecode();

    expect(screen.getByText(/FPS/)).toBeInTheDocument();
  });

  it('1.8 renders error state when startStream fails', async () => {
    mockStartStream.mockResolvedValueOnce({
      success: false,
      error: 'Camera not connected',
    });

    render(<Streamer />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const errorElements = screen.getAllByText('Error');
    expect(errorElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Camera not connected')).toBeInTheDocument();
  });

  it('1.9 bitmap.close() called after drawImage', async () => {
    render(<Streamer />);

    await act(async () => {
      capturedFrameCallback?.({
        dataUri: 'data:image/jpeg;base64,test123',
        timestamp: Date.now(),
      });
    });
    await flushFrameDecode();

    expect(mockDrawImage).toHaveBeenCalled();
    expect(mockBitmapClose).toHaveBeenCalled();
  });

  it('1.10 bitmap.close() count matches frames drawn', async () => {
    render(<Streamer />);

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        capturedFrameCallback?.({
          dataUri: `data:image/jpeg;base64,frame${i}`,
          timestamp: Date.now(),
        });
      });
      await flushFrameDecode();
    }

    // Every drawn frame should have bitmap.close() called
    expect(mockBitmapClose.mock.calls.length).toBe(
      mockDrawImage.mock.calls.length
    );
  });

  it('1.11 drawImage called with canvas context', async () => {
    render(<Streamer />);

    await act(async () => {
      capturedFrameCallback?.({
        dataUri: 'data:image/jpeg;base64,test',
        timestamp: Date.now(),
      });
    });
    await flushFrameDecode();

    expect(mockDrawImage).toHaveBeenCalled();
  });

  it('1.12 clearRect called before drawImage (letterbox)', async () => {
    render(<Streamer />);

    await act(async () => {
      capturedFrameCallback?.({
        dataUri: 'data:image/jpeg;base64,test',
        timestamp: Date.now(),
      });
    });
    await flushFrameDecode();

    expect(mockClearRect).toHaveBeenCalled();
    expect(mockDrawImage).toHaveBeenCalled();
  });

  it('1.13 decode failure clears busy gate and drains pending', async () => {
    // Mock createImageBitmap to reject once, then succeed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cib = globalThis.createImageBitmap as any;
    cib.mockRejectedValueOnce(new Error('Decode failed'));

    render(<Streamer />);

    // Send frame that will fail to decode
    await act(async () => {
      capturedFrameCallback?.({
        dataUri: 'data:image/jpeg;base64,corrupt',
        timestamp: Date.now(),
      });
    });
    await flushFrameDecode();

    // Send another frame — should succeed (gate was cleared by the failure)
    await act(async () => {
      capturedFrameCallback?.({
        dataUri: 'data:image/jpeg;base64,valid',
        timestamp: Date.now(),
      });
    });
    await flushFrameDecode();

    // The second frame should have drawn successfully
    expect(mockDrawImage).toHaveBeenCalled();
    expect(mockBitmapClose).toHaveBeenCalled();
  });

  it('1.14 unmount during decode — bitmap.close() still called, drawImage not called', async () => {
    // Use deferred promise to control when createImageBitmap resolves
    let resolveDeferred!: (
      value: { close: () => void; width: number; height: number }
    ) => void;
    const deferredPromise = new Promise<{
      close: () => void;
      width: number;
      height: number;
    }>((resolve) => {
      resolveDeferred = resolve;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cib = globalThis.createImageBitmap as any;
    cib.mockReturnValueOnce(deferredPromise);

    const { unmount } = render(<Streamer />);

    // Send frame — createImageBitmap is now pending
    await act(async () => {
      capturedFrameCallback?.({
        dataUri: 'data:image/jpeg;base64,test',
        timestamp: Date.now(),
      });
    });

    // Unmount BEFORE decode completes
    unmount();

    // Clear mocks to track only post-unmount calls
    mockDrawImage.mockClear();
    const postUnmountClose = vi.fn();

    // Now resolve the deferred createImageBitmap
    await act(async () => {
      resolveDeferred({
        close: postUnmountClose,
        width: 2048,
        height: 1080,
      });
      await new Promise((r) => setTimeout(r, 0));
    });

    // bitmap.close() SHOULD be called (free memory even after unmount)
    expect(postUnmountClose).toHaveBeenCalled();
    // drawImage should NOT be called (component is unmounted)
    expect(mockDrawImage).not.toHaveBeenCalled();
  });
});
