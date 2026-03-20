/**
 * Frame forwarder tests
 *
 * Tests the frame-dropping gate that prevents unbounded IPC queue growth
 * when forwarding camera frames from the main process to the renderer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFrameForwarder } from '../../src/main/frame-forwarder';

describe('createFrameForwarder', () => {
  let sendFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendFn = vi.fn();
  });

  it('forwards first frame when gate is open', () => {
    const forwarder = createFrameForwarder(sendFn);
    forwarder('data:image/jpeg;base64,abc');

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn).toHaveBeenCalledWith('camera:frame', {
      dataUri: 'data:image/jpeg;base64,abc',
      timestamp: expect.any(Number),
    });
  });

  it('drops second frame before setImmediate fires', () => {
    const forwarder = createFrameForwarder(sendFn);

    forwarder('frame1');
    forwarder('frame2'); // Should be dropped — gate closed

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn).toHaveBeenCalledWith(
      'camera:frame',
      expect.objectContaining({ dataUri: 'frame1' })
    );
  });

  it('forwards frame after setImmediate fires', async () => {
    const forwarder = createFrameForwarder(sendFn);

    forwarder('frame1');
    expect(sendFn).toHaveBeenCalledTimes(1);

    // Wait for setImmediate to fire (reopens gate)
    await new Promise((resolve) => setImmediate(resolve));

    forwarder('frame2');
    expect(sendFn).toHaveBeenCalledTimes(2);
    expect(sendFn).toHaveBeenNthCalledWith(
      2,
      'camera:frame',
      expect.objectContaining({ dataUri: 'frame2' })
    );
  });

  it('does not call sendFn when it is null', () => {
    const forwarder = createFrameForwarder(null);

    // Should not throw
    expect(() => forwarder('frame1')).not.toThrow();
  });

  it('gate starts fresh for each createFrameForwarder call', async () => {
    const forwarder1 = createFrameForwarder(sendFn);
    forwarder1('frame1');
    // Gate is now closed for forwarder1

    // Create a new forwarder (simulating process recreation)
    const forwarder2 = createFrameForwarder(sendFn);
    forwarder2('frame2');

    // Both should have been forwarded — independent gate state
    expect(sendFn).toHaveBeenCalledTimes(2);
  });
});
