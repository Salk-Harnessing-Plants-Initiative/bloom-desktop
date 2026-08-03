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

const TARGETS: Array<{
  namespace: 'python' | 'camera' | 'daq';
  method: string;
  channel: string;
}> = [
  { namespace: 'python', method: 'onStatus', channel: 'python:status' },
  { namespace: 'python', method: 'onError', channel: 'python:error' },
  { namespace: 'camera', method: 'onTrigger', channel: 'camera:trigger' },
  {
    namespace: 'camera',
    method: 'onImageCaptured',
    channel: 'camera:image-captured',
  },
  { namespace: 'daq', method: 'onInitialized', channel: 'daq:initialized' },
  {
    namespace: 'daq',
    method: 'onPositionChanged',
    channel: 'daq:position-changed',
  },
  { namespace: 'daq', method: 'onHome', channel: 'daq:home' },
  { namespace: 'daq', method: 'onError', channel: 'daq:error' },
];

describe('preload listener cleanup', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    exposedAPI = null;
    vi.resetModules();
    await import('../../src/main/preload');
  });

  for (const { namespace, method, channel } of TARGETS) {
    describe(`${namespace}.${method}`, () => {
      it('returns a cleanup function that removes the registered listener', () => {
        const callback = vi.fn();
        const cleanup = exposedAPI[namespace][method](callback);

        expect(cleanup).toBeTypeOf('function');
        expect(mockIpcRenderer.on).toHaveBeenCalledWith(
          channel,
          expect.any(Function)
        );
        const registeredListener = mockIpcRenderer.on.mock.calls[0][1];

        cleanup();

        expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith(
          channel,
          registeredListener
        );
      });

      it('is idempotent — calling cleanup twice does not throw', () => {
        const cleanup = exposedAPI[namespace][method](vi.fn());

        expect(() => {
          cleanup();
          cleanup();
        }).not.toThrow();
        expect(mockIpcRenderer.removeListener).toHaveBeenCalledTimes(2);
      });
    });
  }
});
