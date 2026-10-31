/**
 * The real preload's scanner.onFrame: the last step of a scan's pictures to the page.
 */
import { describe, it, expect, vi } from 'vitest';

const { exposed, ipcRenderer } = vi.hoisted(() => ({
  exposed: {} as Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  ipcRenderer: {
    on: vi.fn(),
    removeListener: vi.fn(),
    invoke: vi.fn(),
    send: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => {
      exposed[name] = api;
    },
  },
  ipcRenderer,
}));

describe('preload scanner.onFrame', () => {
  it('passes on only the picture, and stops when asked', async () => {
    await import('../../src/main/preload');
    const callback = vi.fn();

    const stop = exposed.electron.scanner.onFrame(callback);

    const call = ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === 'scanner:frame'
    );
    expect(call).toBeDefined();
    const listener = call![1];
    listener({ sender: 'ipc event' }, 'data:image/jpeg;base64,AAAA');
    expect(callback).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA');

    stop();
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'scanner:frame',
      listener
    );
  });
});
