// @vitest-environment node
/**
 * Preload Listener Cleanup Tests (#96)
 *
 * Imports the real src/main/preload.ts module (mocking only electron's
 * contextBridge/ipcRenderer) rather than a hand-mocked mirror, so these
 * tests fail if the real module regresses.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIpcRenderer = {
  invoke: vi.fn().mockResolvedValue({}),
  on: vi.fn(),
  removeListener: vi.fn(),
};
let exposedAPI: any = null;

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_name: string, api: any) => {
      exposedAPI = api;
    }),
  },
  ipcRenderer: mockIpcRenderer,
}));

interface Target {
  /** Human-readable label for the describe block, e.g. "python.onStatus". */
  label: string;
  channel: string;
  /** Reaches the listener-registering method on the exposed API, however deep it lives. */
  get: (exposedAPI: any) => (callback: (data: unknown) => void) => () => void; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const TARGETS: Target[] = [
  {
    label: 'python.onStatus',
    channel: 'python:status',
    get: (api) => api.python.onStatus,
  },
  {
    label: 'python.onError',
    channel: 'python:error',
    get: (api) => api.python.onError,
  },
  {
    label: 'camera.onTrigger',
    channel: 'camera:trigger',
    get: (api) => api.camera.onTrigger,
  },
  {
    label: 'camera.onImageCaptured',
    channel: 'camera:image-captured',
    get: (api) => api.camera.onImageCaptured,
  },
  {
    label: 'daq.onInitialized',
    channel: 'daq:initialized',
    get: (api) => api.daq.onInitialized,
  },
  {
    label: 'daq.onPositionChanged',
    channel: 'daq:position-changed',
    get: (api) => api.daq.onPositionChanged,
  },
  {
    label: 'daq.onHome',
    channel: 'daq:home',
    get: (api) => api.daq.onHome,
  },
  {
    label: 'daq.onError',
    channel: 'daq:error',
    get: (api) => api.daq.onError,
  },
  {
    label: 'database.scans.onExportProgress',
    channel: 'db:scans:export-progress',
    get: (api) => api.database.scans.onExportProgress,
  },
];

describe('preload listener cleanup', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    exposedAPI = null;
    vi.resetModules();
    await import('../../src/main/preload');
  });

  for (const target of TARGETS) {
    describe(target.label, () => {
      it('returns a cleanup function that removes the registered listener', () => {
        const callback = vi.fn();
        const cleanup = target.get(exposedAPI)(callback);

        expect(cleanup).toBeTypeOf('function');
        expect(mockIpcRenderer.on).toHaveBeenCalledWith(
          target.channel,
          expect.any(Function)
        );
        const registeredListener = mockIpcRenderer.on.mock.calls[0][1];

        cleanup();

        expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith(
          target.channel,
          registeredListener
        );
      });

      it('is idempotent — calling cleanup twice does not throw', () => {
        const cleanup = target.get(exposedAPI)(vi.fn());

        expect(() => {
          cleanup();
          cleanup();
        }).not.toThrow();
        expect(mockIpcRenderer.removeListener).toHaveBeenCalledTimes(2);
      });
    });
  }
});
