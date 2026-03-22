/**
 * Frame forwarder tests
 *
 * Tests the latest-frame-wins drop gate that prevents unbounded IPC queue
 * growth when forwarding camera frames from the main process to the renderer.
 *
 * Note: vi.useFakeTimers() is intentionally NOT used here because vitest does
 * not fake setImmediate by default. We use real setImmediate for accurate testing.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFrameForwarder } from '../../src/main/frame-forwarder';

describe('createFrameForwarder', () => {
  let sendFn: ReturnType<typeof vi.fn>;
  let getSendFn: () => typeof sendFn | null;

  beforeEach(async () => {
    // Flush any pending setImmediate from previous tests
    await new Promise((resolve) => setImmediate(resolve));
    vi.useRealTimers();
    sendFn = vi.fn();
    getSendFn = () => sendFn;
  });

  it('forwards first frame when gate is open', () => {
    const forwarder = createFrameForwarder(getSendFn);
    forwarder('data:image/jpeg;base64,abc');

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn).toHaveBeenCalledWith('camera:frame', {
      dataUri: 'data:image/jpeg;base64,abc',
      timestamp: expect.any(Number),
    });
  });

  it('drops intermediate frame when gate is closed', () => {
    const forwarder = createFrameForwarder(getSendFn);

    forwarder('frame1');
    forwarder('frame2'); // Buffered — gate closed

    // Only frame1 sent immediately
    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn).toHaveBeenCalledWith(
      'camera:frame',
      expect.objectContaining({ dataUri: 'frame1' })
    );
  });

  it('sends latest frame (not intermediate) when gate reopens', async () => {
    const forwarder = createFrameForwarder(getSendFn);

    forwarder('frame1'); // Sent immediately
    forwarder('frame2'); // Buffered
    forwarder('frame3'); // Replaces frame2 in buffer (latest wins)

    // Wait for setImmediate to fire (gate reopens and sends buffered frame3)
    await new Promise((resolve) => setImmediate(resolve));

    // frame1 sent immediately, frame3 sent on reopen (frame2 dropped)
    expect(sendFn).toHaveBeenCalledTimes(2);
    expect(sendFn).toHaveBeenNthCalledWith(
      2,
      'camera:frame',
      expect.objectContaining({ dataUri: 'frame3' })
    );
  });

  it('forwards all frames at 5 FPS when event loop is not blocked', async () => {
    const forwarder = createFrameForwarder(getSendFn);

    // Simulate 5 frames at 5 FPS with setImmediate yields between each
    for (let i = 0; i < 5; i++) {
      forwarder(`frame${i}`);
      await new Promise((resolve) => setImmediate(resolve));
    }

    // All 5 frames should be forwarded (no unnecessary drops)
    expect(sendFn).toHaveBeenCalledTimes(5);
  });

  it('does not error when getSendFn returns null', () => {
    const forwarder = createFrameForwarder(() => null);

    expect(() => forwarder('frame1')).not.toThrow();
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('gate starts fresh for each createFrameForwarder call', () => {
    const forwarder1 = createFrameForwarder(getSendFn);
    forwarder1('frame1');
    // Gate is now closed for forwarder1

    // Create a new forwarder (simulating process recreation)
    const forwarder2 = createFrameForwarder(getSendFn);
    forwarder2('frame2');

    // Both should have been forwarded — independent gate state
    expect(sendFn).toHaveBeenCalledTimes(2);
  });

  it('does not jam the gate when sendFn throws', async () => {
    const throwingSendFn = vi.fn().mockImplementationOnce(() => {
      throw new Error('webContents destroyed');
    });
    const forwarder = createFrameForwarder(() => throwingSendFn);

    // First call throws — gate should NOT be permanently locked
    forwarder('frame1');

    // Wait for setImmediate
    await new Promise((resolve) => setImmediate(resolve));

    // Second frame should still be forwarded (gate recovered)
    throwingSendFn.mockImplementation(() => {}); // Stop throwing
    forwarder('frame2');
    expect(throwingSendFn).toHaveBeenCalledTimes(2);
  });

  it('re-evaluates getSendFn on each frame (handles window recreation)', async () => {
    let currentSendFn: ReturnType<typeof vi.fn> | null = sendFn;
    const forwarder = createFrameForwarder(() => currentSendFn);

    forwarder('frame1');
    expect(sendFn).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setImmediate(resolve));

    // Simulate window destroyed and recreated
    const newSendFn = vi.fn();
    currentSendFn = newSendFn;

    forwarder('frame2');
    expect(newSendFn).toHaveBeenCalledTimes(1);
    expect(sendFn).toHaveBeenCalledTimes(1); // Old sendFn not called again
  });

  it('ignores empty dataUri', () => {
    const forwarder = createFrameForwarder(getSendFn);
    forwarder('');
    expect(sendFn).not.toHaveBeenCalled();
  });
});
