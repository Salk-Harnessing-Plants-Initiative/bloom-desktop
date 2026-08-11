import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import {
  UploadStatusProvider,
  useUploadStatus,
} from '../../../src/renderer/contexts/UploadStatusContext';

let progressListeners: Array<(data: unknown) => void>;
let unsubscribe: ReturnType<typeof vi.fn>;

beforeEach(() => {
  progressListeners = [];
  unsubscribe = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  win.electron.gravi = {
    ...win.electron.gravi,
    onUploadProgress: vi.fn((cb: (data: unknown) => void) => {
      progressListeners.push(cb);
      return unsubscribe;
    }),
  };
});

function fireProgress(data: unknown) {
  act(() => {
    progressListeners.forEach((cb) => cb(data));
  });
}

function Consumer() {
  const { status } = useUploadStatus();
  return <div data-testid="status">{JSON.stringify(status)}</div>;
}

describe('UploadStatusContext', () => {
  it('subscribes to onUploadProgress exactly once', () => {
    render(
      <UploadStatusProvider>
        <Consumer />
      </UploadStatusProvider>
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gravi = (global.window as any).electron.gravi;
    expect(gravi.onUploadProgress).toHaveBeenCalledTimes(1);
  });

  it('exposes the latest progress to consumers', () => {
    render(
      <UploadStatusProvider>
        <Consumer />
      </UploadStatusProvider>
    );
    // Matches the real graviscan:upload-progress payload shape
    // (box-backup.ts's BoxBackupProgress) — not an arbitrary placeholder.
    fireProgress({
      totalImages: 5,
      completedImages: 2,
      failedImages: 0,
      currentExperiment: 'Exp',
    });

    expect(screen.getByTestId('status').textContent).toContain(
      '"completedImages":2'
    );
  });

  it('keeps the latest known state for a consumer mounted after the event fired', () => {
    const { rerender } = render(
      <UploadStatusProvider>
        <div />
      </UploadStatusProvider>
    );
    fireProgress({
      totalImages: 5,
      completedImages: 3,
      failedImages: 0,
      currentExperiment: 'Exp',
    });

    rerender(
      <UploadStatusProvider>
        <Consumer />
      </UploadStatusProvider>
    );

    expect(screen.getByTestId('status').textContent).toContain(
      '"completedImages":3'
    );
  });

  it('ignores a Bloom-shaped progress event instead of corrupting status with undefined fields', () => {
    // uploadAllScans() delivers both Bloom's (`{total, completed, failed,
    // currentFile}`) and Box's (`{totalImages, completedImages,
    // failedImages, currentExperiment}`) progress ticks over the same
    // onUploadProgress channel with no discriminant tag (see
    // image-handlers.ts's uploadAllScans doc comment). Layout.tsx's
    // banner renders status.completedImages/status.totalImages — a
    // Bloom-shaped event landing here would render "undefined/undefined"
    // instead of being ignored.
    render(
      <UploadStatusProvider>
        <Consumer />
      </UploadStatusProvider>
    );

    fireProgress({
      totalImages: 5,
      completedImages: 2,
      failedImages: 0,
      currentExperiment: 'Exp',
    });
    fireProgress({
      total: 10,
      completed: 4,
      failed: 0,
      currentFile: 'plant1.tif',
    });

    // The Bloom-shaped event must not overwrite the last real Box status
    // with a shape lacking totalImages/completedImages.
    expect(screen.getByTestId('status').textContent).toContain(
      '"completedImages":2'
    );
  });

  it('cleans up the subscription on unmount', () => {
    const { unmount } = render(
      <UploadStatusProvider>
        <Consumer />
      </UploadStatusProvider>
    );
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
