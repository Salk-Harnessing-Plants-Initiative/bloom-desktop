/**
 * The camera passes between the preview and the scanner, which are separate processes:
 * a real Basler camera can only be open in one at a time.
 */
import { describe, it, expect, vi } from 'vitest';
import { createCameraHandoff } from '../../src/main/camera-handoff';

function setup(running = true) {
  const calls: string[] = [];
  const preview = {
    isRunning: () => running,
    stopStream: vi.fn(async () => {
      calls.push('stopStream');
      return true;
    }),
    disconnect: vi.fn(async () => {
      calls.push('disconnect');
      return true;
    }),
  };
  const scanner = {
    cleanup: vi.fn(async () => {
      calls.push('cleanup');
    }),
  };
  const log = vi.fn();
  const handoff = createCameraHandoff({
    getPreview: () => preview,
    getScanner: () => scanner,
    log,
  });
  return { handoff, preview, scanner, calls, log };
}

describe('camera handoff', () => {
  it('stops the preview and then closes its camera', async () => {
    const { handoff, calls } = setup();
    await handoff.releaseFromPreview();
    expect(calls).toEqual(['stopStream', 'disconnect']);
  });

  it('does nothing when the preview process never started', async () => {
    const { handoff, calls } = setup(false);
    await handoff.releaseFromPreview();
    expect(calls).toEqual([]);

    const none = createCameraHandoff({
      getPreview: () => null,
      getScanner: () => null,
    });
    await expect(none.releaseFromPreview()).resolves.toBeUndefined();
    await expect(none.releaseFromScanner()).resolves.toBeUndefined();
  });

  it('still closes the camera if stopping the preview fails', async () => {
    const { handoff, preview, log } = setup();
    preview.stopStream.mockRejectedValue(new Error('Stray error line'));

    await handoff.releaseFromPreview();

    expect(preview.disconnect).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "[Camera] Couldn't release the camera from the preview: Stray error line"
    );
  });

  it('logs when the preview refuses to stop or close', async () => {
    const { handoff, preview, log } = setup();
    preview.stopStream.mockResolvedValue(false);
    preview.disconnect.mockResolvedValue(false);

    await handoff.releaseFromPreview();

    expect(preview.disconnect).toHaveBeenCalledTimes(1);
    expect(log.mock.calls).toEqual([
      [
        "[Camera] Couldn't release the camera from the preview: stopping the stream was refused",
      ],
      [
        "[Camera] Couldn't release the camera from the preview: closing the camera was refused",
      ],
    ]);
  });

  it('logs nothing when all goes well', async () => {
    const { handoff, log } = setup();
    await handoff.releaseFromPreview();
    await handoff.releaseFromScanner();
    expect(log).not.toHaveBeenCalled();
  });

  it('closes the scanner camera', async () => {
    const { handoff, scanner } = setup();
    await handoff.releaseFromScanner();
    expect(scanner.cleanup).toHaveBeenCalledTimes(1);
  });

  it('logs a failure to release instead of stopping the scan', async () => {
    const { handoff, preview, scanner, log } = setup();
    preview.disconnect.mockRejectedValue(new Error('Command timeout'));
    await expect(handoff.releaseFromPreview()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      "[Camera] Couldn't release the camera from the preview: Command timeout"
    );

    scanner.cleanup.mockRejectedValue(
      new Error('Cannot cleanup during active scan')
    );
    await expect(handoff.releaseFromScanner()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      "[Camera] Couldn't release the camera from the scanner: Cannot cleanup during active scan"
    );
  });
});
