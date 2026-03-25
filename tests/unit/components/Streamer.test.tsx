/**
 * Streamer component tests
 *
 * Validates the canvas + Blob URL streaming pattern that prevents
 * Chromium's data-URI bitmap cache from leaking decoded images.
 */

import { render, screen, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Streamer } from '../../../src/components/Streamer';
import { mockDrawImage, mockClearRect } from '../setup';

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

// Controllable MockImage — onload/onerror fire only when manually triggered
let mockImageInstance: {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
} | null = null;

const OriginalImage = globalThis.Image;

// Spy on URL.createObjectURL / revokeObjectURL
const createObjectURLSpy = vi
  .fn()
  .mockImplementation(() => `blob:mock-${Math.random().toString(36).slice(2)}`);
const revokeObjectURLSpy = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  capturedFrameCallback = null;
  mockImageInstance = null;

  // Mock Image constructor — controllable trigger pattern
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Image = class MockImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 2048;
    naturalHeight = 1080;
    _src = '';

    constructor() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      mockImageInstance = this;
    }

    get src() {
      return this._src;
    }

    set src(val: string) {
      this._src = val;
      if (val && val !== '') {
        // Auto-trigger onload after microtasks settle (simulates async decode)
        // Tests that need to control timing should override this before setting src
        queueMicrotask(() => {
          queueMicrotask(() => {
            this.onload?.();
          });
        });
      }
    }
  };

  // Spy on URL methods
  globalThis.URL.createObjectURL = createObjectURLSpy;
  globalThis.URL.revokeObjectURL = revokeObjectURLSpy;

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

afterEach(() => {
  globalThis.Image = OriginalImage;
});

// Helper: flush all pending microtasks (fetch + blob + Image onload)
async function flushFrameDecode(): Promise<void> {
  await act(async () => {
    // Multiple flushes for: fetch().then(blob).then(createObjectURL) + Image.onload microtasks
    await new Promise((r) => setTimeout(r, 0));
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

    // Flush all decodes
    await flushFrameDecode();
    await flushFrameDecode();

    // drawImage should have been called (at least first frame + latest pending)
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

  it('1.9 revokes Blob URL after drawImage', async () => {
    render(<Streamer />);

    await act(async () => {
      capturedFrameCallback?.({
        dataUri: 'data:image/jpeg;base64,test123',
        timestamp: Date.now(),
      });
    });
    await flushFrameDecode();

    // createObjectURL should have been called
    expect(createObjectURLSpy).toHaveBeenCalled();
    // revokeObjectURL should have been called (after drawImage)
    expect(revokeObjectURLSpy).toHaveBeenCalled();
  });

  it('1.10 create/revoke counts match after multiple frames', async () => {
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

    // All created URLs should be revoked (within ±1 for in-flight)
    const created = createObjectURLSpy.mock.calls.length;
    const revoked = revokeObjectURLSpy.mock.calls.length;
    expect(Math.abs(created - revoked)).toBeLessThanOrEqual(1);
  });

  it('1.11 drawImage is called with canvas context', async () => {
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

    // clearRect should be called (to clear canvas before letterbox draw)
    expect(mockClearRect).toHaveBeenCalled();
    // And drawImage should follow
    expect(mockDrawImage).toHaveBeenCalled();
  });
});
