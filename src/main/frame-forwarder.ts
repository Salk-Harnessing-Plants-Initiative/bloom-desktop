/**
 * Frame forwarder with latest-frame-wins drop gate.
 *
 * Electron's webContents.send() is fire-and-forget with no backpressure
 * (electron/electron#27039). If the renderer is busy, serialized IPC messages
 * queue indefinitely in the main process heap. This forwarder drops frames
 * when the previous send hasn't yielded to the event loop yet.
 *
 * @param sendFn - Function to send IPC messages (e.g., webContents.send.bind(webContents)),
 *                 or null if the window is unavailable
 * @returns A frame handler function that accepts a dataUri string
 */
export function createFrameForwarder(
  sendFn: ((channel: string, data: unknown) => void) | null
): (dataUri: string) => void {
  let pendingFrame = false;

  return (dataUri: string) => {
    if (!sendFn) return;
    if (pendingFrame) return; // Drop frame — renderer hasn't consumed the last one

    pendingFrame = true;
    sendFn('camera:frame', {
      dataUri,
      timestamp: Date.now(),
    });

    // Yield to the event loop before accepting the next frame.
    // This allows the IPC message to be flushed before queuing another.
    setImmediate(() => {
      pendingFrame = false;
    });
  };
}
