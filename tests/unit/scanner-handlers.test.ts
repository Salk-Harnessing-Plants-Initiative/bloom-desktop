/**
 * The order of the camera handoff around a scan. A real camera can only be open in one
 * process, so each step must finish before the next starts.
 */
import { EventEmitter } from 'events';
import { describe, it, expect, vi } from 'vitest';
import { registerScannerHandlers } from '../../src/main/scanner-handlers';
import type { ScannerProcess } from '../../src/main/cylinderscan/scanner-process';
import type { PythonProcess } from '../../src/main/python-process';
import type { ScannerSettings } from '../../src/types/scanner';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const SETTINGS = { camera: {}, daq: {} } as unknown as ScannerSettings;

function setup(options: { python?: boolean } = {}) {
  const calls: string[] = [];
  const handlers = new Map<string, Handler>();
  const ipcMain = {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  };

  const scanner = Object.assign(new EventEmitter(), {
    initialize: vi.fn(async (settings: ScannerSettings) => {
      calls.push('scanner.initialize');
      return { success: true, initialized: true, settings };
    }),
    scan: vi.fn(async () => {
      calls.push('scanner.scan');
      return { success: true, frames_captured: 72, output_path: '/scans/a' };
    }),
    cleanup: vi.fn(async () => {
      calls.push('scanner.cleanup');
      return { success: true, initialized: false };
    }),
    getStatus: vi.fn(async () => ({ initialized: true })),
  });
  const preview = {
    isRunning: () => true,
    stopStream: vi.fn(async () => {
      calls.push('preview.stopStream');
      return true;
    }),
    disconnect: vi.fn(async () => {
      calls.push('preview.disconnect');
      return true;
    }),
  };
  const window = {
    isDestroyed: () => false,
    webContents: {
      send: vi.fn((channel: string) => {
        calls.push(`send ${channel}`);
      }),
    },
  };
  const idleTimer = {
    resetTimer: vi.fn(),
    pauseForScan: vi.fn(() => {
      calls.push('idle.pause');
    }),
    resumeAfterScan: vi.fn(() => {
      calls.push('idle.resume');
    }),
  };

  const registered = registerScannerHandlers({
    ipcMain: ipcMain as never,
    getPythonProcess: () =>
      options.python === false ? null : ({} as PythonProcess),
    createScanner: () => scanner as unknown as ScannerProcess,
    getPreview: () => preview,
    getMainWindow: () => window as never,
    getIdleTimer: () => idleTimer,
    getConfiguredCameraIp: () => null,
  });

  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`No handler for ${channel}`);
    return handler({}, ...args);
  };
  return { invoke, calls, scanner, preview, window, idleTimer, registered };
}

// Lets an event's async listener finish.
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('scanner handlers: the camera handoff', () => {
  it("closes the preview's camera before starting the scanner", async () => {
    const { invoke, calls } = setup();

    await invoke('scanner:initialize', SETTINGS);

    expect(calls).toEqual([
      'preview.stopStream',
      'preview.disconnect',
      'scanner.initialize',
    ]);
  });

  it('waits for the camera to close, not just for the call to start', async () => {
    const { invoke, preview, scanner } = setup();
    let finishClosing: (closed: boolean) => void = () => undefined;
    preview.disconnect.mockReturnValue(
      new Promise((resolve) => (finishClosing = resolve))
    );

    const starting = invoke('scanner:initialize', SETTINGS);
    await settle();
    expect(scanner.initialize).not.toHaveBeenCalled();

    finishClosing(true);
    await starting;
    expect(scanner.initialize).toHaveBeenCalledTimes(1);
  });

  it('starts the scanner even if the preview would not let go, so the operator sees why', async () => {
    const { invoke, preview, scanner } = setup();
    preview.disconnect.mockRejectedValue(new Error('No response'));

    await invoke('scanner:initialize', SETTINGS);

    expect(scanner.initialize).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['complete', 'scanner:complete', { success: true }],
    ['error', 'scanner:error', 'Scan failed'],
  ])(
    "closes the scanner's camera before telling the page of '%s'",
    async (event, channel, payload) => {
      const { invoke, calls, scanner } = setup();
      await invoke('scanner:initialize', SETTINGS);
      calls.length = 0;

      scanner.emit(event, payload);
      await settle();

      expect(calls).toEqual(['scanner.cleanup', `send ${channel}`]);
    }
  );

  it("doesn't tell a closed window", async () => {
    const { invoke, scanner, window } = setup();
    await invoke('scanner:initialize', SETTINGS);
    window.isDestroyed = () => true;

    scanner.emit('complete', { success: true });
    await settle();

    expect(scanner.cleanup).toHaveBeenCalledTimes(1);
    expect(window.webContents.send).not.toHaveBeenCalled();
  });

  it("forwards each frame's picture to the page", async () => {
    const { invoke, scanner, window } = setup();
    await invoke('scanner:initialize', SETTINGS);

    scanner.emit('frame', 'data:image/jpeg;base64,AAAA');

    expect(window.webContents.send).toHaveBeenCalledWith(
      'scanner:frame',
      'data:image/jpeg;base64,AAAA'
    );
  });

  it('forwards progress to the page', async () => {
    const { invoke, scanner, window } = setup();
    await invoke('scanner:initialize', SETTINGS);
    const progress = { frame_number: 11, total_frames: 72, position: 55 };

    scanner.emit('progress', progress);

    expect(window.webContents.send).toHaveBeenCalledWith(
      'scanner:progress',
      progress
    );
  });
});

describe('scanner handlers: scanner:scan', () => {
  it('reports a scan in progress only while it runs', async () => {
    const { invoke, scanner, registered } = setup();
    await invoke('scanner:initialize', SETTINGS);
    let finish: (result: unknown) => void = () => undefined;
    scanner.scan.mockReturnValueOnce(
      new Promise((resolve) => (finish = resolve)) as never
    );
    expect(registered.isScanInProgress()).toBe(false);

    const scan = invoke('scanner:scan');
    expect(registered.isScanInProgress()).toBe(true);

    finish({ success: true, frames_captured: 72, output_path: '/scans/a' });
    await scan;
    expect(registered.isScanInProgress()).toBe(false);
  });

  it('pauses the idle clock for the scan, then resumes it and closes the camera', async () => {
    const { invoke, calls } = setup();
    await invoke('scanner:initialize', SETTINGS);
    calls.length = 0;

    const result = await invoke('scanner:scan');

    expect(result).toMatchObject({ success: true, frames_captured: 72 });
    expect(calls).toEqual([
      'idle.pause',
      'scanner.scan',
      'idle.resume',
      'scanner.cleanup',
    ]);
  });

  it('closes the camera and reports the error when the scan is cancelled', async () => {
    const { invoke, scanner, idleTimer } = setup();
    await invoke('scanner:initialize', SETTINGS);
    scanner.scan.mockRejectedValue(new Error('Scan cancelled'));

    const result = await invoke('scanner:scan');

    expect(result).toEqual({
      success: false,
      frames_captured: 0,
      output_path: '',
      error: 'Scan cancelled',
    });
    expect(scanner.cleanup).toHaveBeenCalledTimes(1);
    expect(idleTimer.resumeAfterScan).toHaveBeenCalledTimes(1);
  });

  it('resumes the idle clock even if closing the camera never finishes', async () => {
    const { invoke, scanner, idleTimer } = setup();
    await invoke('scanner:initialize', SETTINGS);
    scanner.cleanup.mockReturnValue(new Promise(() => undefined));

    void invoke('scanner:scan');
    await settle();

    expect(idleTimer.resumeAfterScan).toHaveBeenCalledTimes(1);
  });

  it("doesn't touch the idle clock when the scanner isn't initialized", async () => {
    const { invoke, idleTimer } = setup();

    const result = await invoke('scanner:scan');

    expect(result).toMatchObject({
      success: false,
      error: 'Scanner not initialized. Call initialize() first.',
    });
    expect(idleTimer.pauseForScan).not.toHaveBeenCalled();
    expect(idleTimer.resumeAfterScan).not.toHaveBeenCalled();
  });
});

describe('scanner handlers: errors', () => {
  it('reports a failed start instead of throwing', async () => {
    const { invoke } = setup({ python: false });

    await expect(invoke('scanner:initialize', SETTINGS)).resolves.toEqual({
      success: false,
      initialized: false,
      error: 'Python process not initialized',
    });
  });

  it('reports a clean cleanup and status before the scanner exists', async () => {
    const { invoke } = setup();

    await expect(invoke('scanner:cleanup')).resolves.toEqual({
      success: true,
      initialized: false,
    });
    await expect(invoke('scanner:get-status')).resolves.toMatchObject({
      success: true,
      initialized: false,
    });
  });
});
