/**
 * Passes the camera between the live preview and the scanner. They run in separate
 * Python processes, and a Basler camera can only be open in one at a time: a second
 * open fails with "device is controlled by another application". So the preview
 * closes the camera before the scanner opens it, and the scanner closes it when a scan
 * ends, before the preview starts again. A failure to release is logged, not thrown:
 * the next open then reports the problem to the operator.
 */

export interface PreviewCameraLike {
  isRunning(): boolean;
  stopStream(): Promise<boolean>;
  disconnect(): Promise<boolean>;
}

export interface ScannerCameraLike {
  cleanup(): Promise<unknown>;
}

export interface CameraHandoffDeps {
  getPreview: () => PreviewCameraLike | null;
  getScanner: () => ScannerCameraLike | null;
  log?: (message: string) => void;
}

export function createCameraHandoff(deps: CameraHandoffDeps) {
  const log = deps.log ?? console.error;
  const failure = (what: string, error: unknown) =>
    log(
      `[Camera] Couldn't release the camera from the ${what}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );

  return {
    /** Before a scan: stop the preview and close its camera. */
    async releaseFromPreview(): Promise<void> {
      const preview = deps.getPreview();
      if (!preview?.isRunning()) return;
      // Separately: the close is what frees the camera, whatever the stop does.
      try {
        if (!(await preview.stopStream())) {
          failure('preview', new Error('stopping the stream was refused'));
        }
      } catch (error) {
        failure('preview', error);
      }
      try {
        if (!(await preview.disconnect())) {
          failure('preview', new Error('closing the camera was refused'));
        }
      } catch (error) {
        failure('preview', error);
      }
    },

    /** After a scan: close the scanner's camera, so the preview can open it. */
    async releaseFromScanner(): Promise<void> {
      try {
        await deps.getScanner()?.cleanup();
      } catch (error) {
        failure('scanner', error);
      }
    },
  };
}
