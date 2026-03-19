# Renderer Memory Leak Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix renderer V8 OOM (3.8 GB) caused by unbounded Image object creation in the Streamer component, plus secondary correctness bugs.

**Architecture:** Replace canvas-based `new Image()` per-frame rendering with React `useState` + `<img>` tag (proven in pilot). Reduce streaming FPS from 30 to 5. Fix sendCommand timeout leak and detectCameras response handling. Add Python context managers for frame encoding.

**Tech Stack:** React + TypeScript (Vitest, React Testing Library), Python (pytest), Electron IPC

**Spec:** `docs/superpowers/specs/2026-03-19-renderer-memory-leak-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `tests/unit/components/Streamer.test.tsx` | Create | Streamer unit tests |
| `src/components/Streamer.tsx` | Modify | Replace canvas with `<img>` tag + useState |
| `python/tests/test_camera_streaming.py` | Modify | Update FPS assertions from 30 to 5 |
| `python/ipc_handler.py:406` | Modify | Change `target_fps = 30` to `target_fps = 5` |
| `tests/unit/python-process.test.ts` | Create | PythonProcess sendCommand timeout tests |
| `src/main/python-process.ts:145-173` | Modify | Store and clear timeout ID |
| `tests/unit/camera-process.test.ts` | Create | CameraProcess detectCameras tests |
| `src/main/camera-process.ts:199-225` | Modify | Handle non-camera success responses |
| `python/tests/test_camera_streaming.py` | Modify | Add context manager resource test |
| `python/hardware/camera_mock.py:228-234` | Modify | Add context managers |
| `python/hardware/camera.py:212-216` | Modify | Add context managers |
| `src/types/electron.d.ts:157,173` | Modify | Update "~30 FPS" JSDoc to "~5 FPS" |
| `src/main/camera-process.ts:165` | Modify | Update "~30 FPS" JSDoc to "~5 FPS" |
| `python/ipc_handler.py:404` | Modify | Update "~30 FPS" docstring to "~5 FPS" |

---

### Task 1: Streamer — Write failing tests

**Files:**
- Create: `tests/unit/components/Streamer.test.tsx`

- [ ] **Step 1: Create Streamer test file with mocks and 7 test cases**

The global test setup (`tests/unit/setup.ts`) only mocks `window.electron.python` and `window.electron.database`. The Streamer needs `window.electron.camera` mocked. Set this up per-test.

```tsx
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

    // Before any frame arrives, should show waiting/connecting state
    expect(screen.getByText('Connecting...')).toBeInTheDocument();
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/Streamer.test.tsx`
Expected: Tests 1.1, 1.4 FAIL (current Streamer uses canvas, not img tag). Tests 1.2, 1.3, 1.5, 1.6, 1.7 may pass or fail depending on mock setup.

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/unit/components/Streamer.test.tsx
git commit -m "test: add Streamer component tests for img-tag pattern (red)"
```

---

### Task 2: Streamer — Implement img-tag pattern

**Files:**
- Modify: `src/components/Streamer.tsx` (full rewrite)

- [ ] **Step 1: Replace Streamer implementation**

Replace the entire component body. Keep the same props interface (`StreamerProps`) and exports.

```tsx
/**
 * Camera Streamer Component
 *
 * Displays live camera stream with automatic lifecycle management.
 * Uses React state + <img> tag for natural "latest frame wins" memory safety.
 * Automatically starts streaming on mount and stops on unmount.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { CameraSettings } from '../types/camera';

export interface StreamerProps {
  /**
   * Camera settings for streaming
   * Optional - will use camera's current settings if not provided
   */
  settings?: Partial<CameraSettings>;

  /**
   * Width of the display area in pixels
   * @default 640
   */
  width?: number;

  /**
   * Height of the display area in pixels
   * @default 480
   */
  height?: number;

  /**
   * Whether to show FPS counter
   * @default true
   */
  showFps?: boolean;

  /**
   * Callback when streaming starts successfully
   */
  onStreamStart?: () => void;

  /**
   * Callback when streaming stops
   */
  onStreamStop?: () => void;

  /**
   * Callback when an error occurs
   */
  onError?: (error: string) => void;
}

/**
 * Streamer component for live camera preview
 */
export const Streamer: React.FC<StreamerProps> = ({
  settings,
  width = 640,
  height = 480,
  showFps = true,
  onStreamStart,
  onStreamStop,
  onError,
}) => {
  const [currentFrame, setCurrentFrame] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // FPS calculation
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(Date.now());

  const updateFps = useCallback(() => {
    frameCountRef.current++;
    const now = Date.now();
    const elapsed = now - lastFpsUpdateRef.current;

    // Update FPS every second
    if (elapsed >= 1000) {
      setFps(Math.round((frameCountRef.current * 1000) / elapsed));
      frameCountRef.current = 0;
      lastFpsUpdateRef.current = now;
    }
  }, []);

  // Handle incoming frames — useState naturally keeps only the latest
  const handleFrame = useCallback(
    (image: { dataUri: string; timestamp: number }) => {
      setCurrentFrame(image.dataUri);
      updateFps();
    },
    [updateFps]
  );

  // Start streaming on mount
  useEffect(() => {
    let mounted = true;

    const startStreaming = async () => {
      try {
        const response = await window.electron.camera.startStream(settings);

        if (!mounted) return;

        if (response.success) {
          setIsStreaming(true);
          setError(null);
          onStreamStart?.();
        } else {
          const errorMsg = response.error || 'Failed to start streaming';
          setError(errorMsg);
          onError?.(errorMsg);
        }
      } catch (err) {
        if (!mounted) return;

        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
        onError?.(errorMsg);
      }
    };

    startStreaming();

    // Register frame callback and get cleanup function
    const removeFrameListener = window.electron.camera.onFrame(handleFrame);

    // Cleanup: stop streaming and remove listener on unmount
    return () => {
      mounted = false;
      removeFrameListener();
      window.electron.camera.stopStream().then(() => {
        setIsStreaming(false);
        onStreamStop?.();
      });
    };
  }, [settings, handleFrame, onStreamStart, onStreamStop, onError]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {currentFrame ? (
        <img
          src={currentFrame}
          alt="Camera stream"
          style={{
            width,
            height,
            objectFit: 'contain',
            border: '1px solid #ccc',
            display: 'block',
            backgroundColor: '#000',
          }}
        />
      ) : (
        <div
          style={{
            width,
            height,
            border: '1px solid #ccc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#000',
          }}
        >
          <span style={{ color: '#fff', fontSize: '14px' }}>
            {error ? 'Error' : 'Connecting...'}
          </span>
        </div>
      )}

      {/* FPS Counter */}
      {showFps && (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: '#fff',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '14px',
            fontFamily: 'monospace',
          }}
        >
          {fps} FPS
        </div>
      )}

      {/* Status Indicator */}
      <div
        style={{
          position: 'absolute',
          top: '8px',
          left: '8px',
          display: 'flex',
          alignItems: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: error
              ? '#f44336'
              : isStreaming
                ? '#4caf50'
                : '#ff9800',
            marginRight: '6px',
          }}
        />
        <span style={{ color: '#fff' }}>
          {error ? 'Error' : isStreaming ? 'Streaming' : 'Connecting...'}
        </span>
      </div>

      {/* Error Message */}
      {error && (
        <div
          style={{
            position: 'absolute',
            bottom: '8px',
            left: '8px',
            right: '8px',
            backgroundColor: 'rgba(244, 67, 54, 0.9)',
            color: '#fff',
            padding: '8px',
            borderRadius: '4px',
            fontSize: '12px',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Run Streamer tests to verify they pass**

Run: `npx vitest run tests/unit/components/Streamer.test.tsx`
Expected: All 7 tests PASS

- [ ] **Step 3: Run full unit test suite to check for regressions**

Run: `npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 4: Commit**

```bash
git add src/components/Streamer.tsx
git commit -m "fix: replace canvas with img tag in Streamer to prevent OOM"
```

---

### Task 3: Reduce streaming FPS from 30 to 5

**Files:**
- Modify: `python/tests/test_camera_streaming.py:229-237,361-364`
- Modify: `python/ipc_handler.py:404,406`
- Modify: `src/types/electron.d.ts:157,173`
- Modify: `src/main/camera-process.ts:165`

- [ ] **Step 1: Update Python streaming test assertions for 5 FPS**

In `python/tests/test_camera_streaming.py`, update two tests:

`test_start_stream_sends_frames` (line 229-237): Change sleep to 1.5s and assert >= 3 frames:
```python
        # Wait for frames to be sent (should get ~7 frames in 1.5s at 5 FPS)
        time.sleep(1.5)
        captured = self.capsys.readouterr()

        # Should see FRAME: protocol messages
        assert "FRAME:" in captured.out
        # Should have frames at ~5 FPS rate (not 30 FPS)
        frame_count = captured.out.count("FRAME:")
        assert frame_count >= 3, f"Expected at least 3 frames, got {frame_count}"
        assert frame_count <= 15, f"Expected at most 15 frames (5 FPS), got {frame_count}"
```

`test_start_stream_stop_stream_lifecycle` (line 361-364): Change assert to >= 3 frames:
```python
        # Wait for frames
        time.sleep(1.5)  # Should get ~7 frames at 5 FPS
        captured = self.capsys.readouterr()
        frame_count = captured.out.count("FRAME:")
        assert frame_count >= 3, f"Expected at least 3 frames, got {frame_count}"
        assert frame_count <= 15, f"Expected at most 15 frames (5 FPS), got {frame_count}"
```

- [ ] **Step 2: Run Python streaming tests to verify they fail (still 30 FPS)**

Run: `cd python && uv run pytest tests/test_camera_streaming.py -v -k "test_start_stream_sends_frames or test_start_stream_stop_stream_lifecycle"`
Expected: Tests may pass with high frame counts, but the implementation still says 30 FPS.

- [ ] **Step 3: Change target_fps to 5 in ipc_handler.py**

In `python/ipc_handler.py`, change line 404 and 406:

Line 404 docstring: `"~30 FPS"` → `"~5 FPS"`
Line 406: `target_fps = 30` → `target_fps = 5`

```python
def streaming_worker() -> None:
    """Background thread worker for camera streaming.

    Continuously captures frames from the camera and sends them via FRAME: protocol
    while _streaming_active is set. Targets ~5 FPS (200ms per frame).
    """
    target_fps = 5
    frame_interval = 1.0 / target_fps
```

- [ ] **Step 4: Update JSDoc comments referencing 30 FPS**

In `src/types/electron.d.ts`:
- Line 157: `"at ~30 FPS"` → `"at ~5 FPS"`
- Line 173: `"at ~30 FPS"` → `"at ~5 FPS"`

In `src/main/camera-process.ts`:
- Line 165: `"at ~30 FPS"` → `"at ~5 FPS"`

- [ ] **Step 5: Run Python streaming tests to verify they pass**

Run: `cd python && uv run pytest tests/test_camera_streaming.py -v`
Expected: All streaming tests PASS

- [ ] **Step 6: Commit**

```bash
git add python/ipc_handler.py python/tests/test_camera_streaming.py src/types/electron.d.ts src/main/camera-process.ts
git commit -m "fix: reduce streaming FPS from 30 to 5 for preview use case"
```

---

### Task 4: Fix sendCommand timeout leak

**Files:**
- Create: `tests/unit/python-process.test.ts`
- Modify: `src/main/python-process.ts:145-173`

- [ ] **Step 1: Create PythonProcess test file**

PythonProcess extends EventEmitter and spawns a child process. For unit testing, we test the class directly by emitting events to simulate Python responses.

```typescript
/**
 * PythonProcess unit tests
 *
 * Tests sendCommand timeout cleanup to prevent closure leaks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// We test the sendCommand logic by importing PythonProcess and mocking the spawn
vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue({
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    killed: false,
  }),
}));

import { PythonProcess } from '../../src/main/python-process';

describe('PythonProcess.sendCommand', () => {
  let process: PythonProcess;

  beforeEach(async () => {
    vi.useFakeTimers();
    process = new PythonProcess('/fake/python', ['--ipc']);

    // Simulate startup: emit 'status' with 'ready' after start() is called
    const startPromise = process.start();
    // The process listens for 'status' containing 'ready'
    setTimeout(() => process.emit('status', 'IPC handler ready'), 10);
    vi.advanceTimersByTime(10);
    await startPromise;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.stop();
  });

  it('3.1 clears timeout when data response arrives', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const commandPromise = process.sendCommand({ command: 'test' });

    // Simulate response
    process.emit('data', { success: true });

    const result = await commandPromise;
    expect(result).toEqual({ success: true });
    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  it('3.2 clears timeout when error response arrives', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const commandPromise = process.sendCommand({ command: 'test' });

    // Simulate error
    process.emit('error', 'Something failed');

    await expect(commandPromise).rejects.toThrow('Something failed');
    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  it('3.3 timeout still fires if no response', async () => {
    const commandPromise = process.sendCommand({ command: 'test' });

    // Advance past the 3-minute timeout
    vi.advanceTimersByTime(180001);

    await expect(commandPromise).rejects.toThrow('Command timeout');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/python-process.test.ts`
Expected: Tests 3.1 and 3.2 FAIL (`clearTimeout` never called). Test 3.3 should PASS.

- [ ] **Step 3: Fix sendCommand to clear timeout on response**

In `src/main/python-process.ts`, modify the `sendCommand` method (lines 145-173):

```typescript
  async sendCommand(command: object): Promise<any> {
    if (!this.process || !this.process.stdin) {
      throw new Error('Process not started');
    }

    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dataHandler = (data: any) => {
        clearTimeout(timeoutId);
        this.removeListener('data', dataHandler);
        this.removeListener('error', errorHandler);
        resolve(data);
      };

      const errorHandler = (error: string) => {
        clearTimeout(timeoutId);
        this.removeListener('data', dataHandler);
        this.removeListener('error', errorHandler);
        reject(new Error(error));
      };

      this.once('data', dataHandler);
      this.once('error', errorHandler);

      // Send command as line-delimited JSON
      const commandJson = JSON.stringify(command);
      this.process.stdin!.write(`${commandJson}\n`);

      // Timeout for command response
      const timeoutId = setTimeout(() => {
        this.removeListener('data', dataHandler);
        this.removeListener('error', errorHandler);
        reject(new Error('Command timeout'));
      }, COMMAND_TIMEOUT_MS);
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/python-process.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/python-process.test.ts src/main/python-process.ts
git commit -m "fix: clear sendCommand timeout on response to prevent closure leak"
```

---

### Task 5: Fix detectCameras response handling

**Files:**
- Create: `tests/unit/camera-process.test.ts`
- Modify: `src/main/camera-process.ts:199-225`

- [ ] **Step 1: Create CameraProcess test file**

CameraProcess extends PythonProcess. We mock `sendCommand` to test `detectCameras` logic in isolation.

```typescript
/**
 * CameraProcess unit tests
 *
 * Tests detectCameras response handling for various response formats.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    stdin: { write: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    killed: false,
  }),
}));

import { CameraProcess } from '../../src/main/camera-process';

describe('CameraProcess.detectCameras', () => {
  let camera: CameraProcess;

  beforeEach(() => {
    camera = new CameraProcess('/fake/python', ['--ipc']);
  });

  it('4.1 returns array when response is array', async () => {
    const mockCameras = [
      { ip_address: '192.168.1.100', model_name: 'acA2000-50gm', serial_number: '123', mac_address: 'aa:bb', user_defined_name: 'test', friendly_name: 'Test Cam', is_mock: false },
    ];
    vi.spyOn(camera, 'sendCommand').mockResolvedValue(mockCameras);

    const result = await camera.detectCameras();
    expect(result).toEqual(mockCameras);
  });

  it('4.2 returns cameras when response has cameras field', async () => {
    const mockCameras = [
      { ip_address: '192.168.1.100', model_name: 'acA2000-50gm', serial_number: '123', mac_address: 'aa:bb', user_defined_name: 'test', friendly_name: 'Test Cam', is_mock: false },
    ];
    vi.spyOn(camera, 'sendCommand').mockResolvedValue({ cameras: mockCameras, count: 1 });

    const result = await camera.detectCameras();
    expect(result).toEqual(mockCameras);
  });

  it('4.3 returns empty array for non-camera success response', async () => {
    // This happens when response routing delivers a configure response to detectCameras
    vi.spyOn(camera, 'sendCommand').mockResolvedValue({ success: true, configured: true });

    const result = await camera.detectCameras();
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify 4.3 fails**

Run: `npx vitest run tests/unit/camera-process.test.ts`
Expected: Test 4.3 FAILS (throws `Error: Failed to detect cameras`). Tests 4.1, 4.2 PASS.

- [ ] **Step 3: Fix detectCameras to handle non-camera responses**

In `src/main/camera-process.ts`, replace lines 215-224:

```typescript
    // Handle both direct array response and wrapped response
    if (Array.isArray(response)) {
      return response;
    }

    if (response && response.cameras) {
      return response.cameras;
    }

    // Non-camera response (e.g. mismatched command routing) — return empty
    return [];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/camera-process.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/camera-process.test.ts src/main/camera-process.ts
git commit -m "fix: handle non-camera responses in detectCameras gracefully"
```

---

### Task 6: Python context managers for frame encoding

**Files:**
- Modify: `python/hardware/camera_mock.py:228-234`
- Modify: `python/hardware/camera.py:212-216`
- Modify: `python/tests/test_camera_streaming.py` (add resource test)

- [ ] **Step 1: Add resource leak test to test_camera_streaming.py**

Add to the `TestGrabFrameBase64` class in `python/tests/test_camera_streaming.py`:

```python
    def test_grab_frame_base64_no_resource_leak(self):
        """Verify grab_frame_base64 does not leak file handles (context managers)."""
        import warnings

        settings = CameraSettings(
            exposure_time=10000,
            gain=100,
            camera_ip_address="192.168.1.100",
            num_frames=1,
        )
        camera = MockCamera(settings)
        camera.open()

        # Call multiple times and check for ResourceWarning
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            for _ in range(50):
                camera.grab_frame_base64()

            resource_warnings = [x for x in w if issubclass(x.category, ResourceWarning)]
            assert len(resource_warnings) == 0, f"Got ResourceWarnings: {resource_warnings}"
```

- [ ] **Step 2: Run test to verify it passes (or fails with warnings)**

Run: `cd python && uv run pytest tests/test_camera_streaming.py::TestGrabFrameBase64::test_grab_frame_base64_no_resource_leak -v`
Expected: May PASS (Python GC handles it) or may show ResourceWarnings. Either way, adding context managers is the correct fix.

- [ ] **Step 3: Add context managers to camera_mock.py**

In `python/hardware/camera_mock.py`, replace lines 228-234:

```python
        # Convert numpy array to PIL Image and encode as PNG
        with BytesIO() as buffer:
            with Image.fromarray(img) as pil_img:
                pil_img.save(buffer, format="PNG", compress_level=0)
            base64_data = base64.b64encode(buffer.getvalue()).decode("utf-8")

        return f"data:image/png;base64,{base64_data}"
```

- [ ] **Step 4: Add context managers to camera.py**

In `python/hardware/camera.py`, replace the `_img_to_base64` method (lines 212-216):

```python
        with BytesIO() as buffer:
            with Image.fromarray(img) as pil_img:
                pil_img.save(buffer, format="PNG", compress_level=0)
            base64_img = base64.b64encode(buffer.getvalue()).decode("utf-8")
        return base64_img
```

- [ ] **Step 5: Run all Python tests to verify no regressions**

Run: `cd python && uv run pytest tests/test_camera_streaming.py -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add python/hardware/camera_mock.py python/hardware/camera.py python/tests/test_camera_streaming.py
git commit -m "fix: add context managers for frame encoding to prevent resource leaks"
```

---

### Task 7: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full TypeScript unit test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run full Python test suite**

Run: `cd python && uv run pytest -v`
Expected: All tests PASS

- [ ] **Step 3: Start the app and verify streaming works**

Run: `npm start`
Expected: Navigate to Camera Settings, click Apply Settings — live preview should show frames at ~5 FPS using an `<img>` tag. No OOM after extended use.

- [ ] **Step 4: Commit any final fixes if needed, then done**
