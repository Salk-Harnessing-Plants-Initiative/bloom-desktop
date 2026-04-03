/**
 * Frame forwarder with latest-frame-wins drop gate.
 *
 * Electron's webContents.send() is fire-and-forget with no backpressure
 * (electron/electron#27039). If the renderer is busy, serialized IPC messages
 * queue indefinitely in the main process heap. This forwarder buffers the
 * latest frame and drops intermediate ones when the event loop is blocked.
 *
 * @param getSendFn - Getter that returns the current send function (or null if
 *                    the window is unavailable). Re-evaluated on each frame to
 *                    handle window recreation on macOS.
 * @returns A frame handler function that accepts a dataUri string
 */
export function createFrameForwarder(
  getSendFn: () => ((channel: string, data: unknown) => void) | null
): (dataUri: string) => void {
  let gateClosed = false;
  let bufferedFrame: string | null = null;

  function trySend(dataUri: string): void {
    const sendFn = getSendFn();
    if (!sendFn) return;
    try {
      sendFn('camera:frame', { dataUri, timestamp: Date.now() });
    } catch {
      // webContents may have been destroyed between getSendFn() and send()
    }
  }

  return (dataUri: string) => {
    if (!dataUri) return;

    if (gateClosed) {
      // Gate closed — buffer the latest frame (overwrites previous)
      bufferedFrame = dataUri;
      return;
    }

    // Gate open — send immediately and close gate
    gateClosed = true;
    trySend(dataUri);

    setImmediate(() => {
      gateClosed = false;
      // Send buffered frame if one arrived while gate was closed.
      // This does NOT re-close the gate — by design, since Node.js is
      // single-threaded, no frame can arrive during trySend(). The next
      // frame from the event loop will see gateClosed=false and send normally.
      if (bufferedFrame !== null) {
        const frame = bufferedFrame;
        bufferedFrame = null;
        trySend(frame);
      }
    });
  };
}
