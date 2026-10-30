/**
 * Browse Scans' "Upload all" bar (#449).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { UploadAllBar } from '../../../src/renderer/components/UploadAllBar';
import type { UploadAllProgress } from '../../../src/types/upload-all';

const pendingUploads = vi.fn();
const uploadAll = vi.fn();
const stopUploadAll = vi.fn().mockResolvedValue({ success: true });
let progressListener: ((p: UploadAllProgress) => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  progressListener = null;
  pendingUploads.mockResolvedValue({ success: true, data: { count: 3 } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  win.electron = {
    ...win.electron,
    database: {
      ...win.electron?.database,
      scans: {
        pendingUploads,
        uploadAll,
        stopUploadAll,
        onUploadAllProgress: (cb: (p: UploadAllProgress) => void) => {
          progressListener = cb;
          return () => (progressListener = null);
        },
      },
    },
  };
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

const filters = { experimentId: 'exp-1', dateFrom: '2026-10-01', dateTo: '' };

function renderBar(onFinished = vi.fn()) {
  render(
    <UploadAllBar filters={filters} refreshKey={1} onFinished={onFinished} />
  );
  return onFinished;
}

describe('UploadAllBar', () => {
  it('shows how many scans are waiting, within the filters', async () => {
    renderBar();
    expect(
      await screen.findByText('3 scans not yet uploaded')
    ).toBeInTheDocument();
    expect(screen.getByTestId('upload-all-button')).toHaveTextContent(
      'Upload all (3)'
    );
    expect(pendingUploads).toHaveBeenCalledWith(filters);
  });

  it('is disabled with nothing to upload', async () => {
    pendingUploads.mockResolvedValue({ success: true, data: { count: 0 } });
    renderBar();
    expect(
      await screen.findByText('All scans are uploaded.')
    ).toBeInTheDocument();
    expect(screen.getByTestId('upload-all-button')).toBeDisabled();
    expect(screen.getByTestId('upload-all-button')).toHaveTextContent(
      'Nothing to upload'
    );
  });

  it('asks first, and does nothing when the answer is no', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    renderBar();
    fireEvent.click(await screen.findByText('Upload all (3)'));
    expect(window.confirm).toHaveBeenCalledWith('Upload 3 scans to Bloom?');
    expect(uploadAll).not.toHaveBeenCalled();
  });

  it('shows progress while uploading, can stop, and reports the result', async () => {
    let finish: (value: unknown) => void = () => undefined;
    uploadAll.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const onFinished = renderBar();
    fireEvent.click(await screen.findByText('Upload all (3)'));

    expect(uploadAll).toHaveBeenCalledWith(filters);
    act(() =>
      progressListener?.({
        done: 1,
        total: 3,
        uploadedScans: 1,
        failedScans: 0,
      })
    );
    expect(screen.getByTestId('upload-all-status')).toHaveTextContent(
      'Uploading 2 of 3…'
    );

    fireEvent.click(screen.getByTestId('upload-all-stop'));
    expect(stopUploadAll).toHaveBeenCalled();
    expect(
      await screen.findByText('Stopping after this scan…')
    ).toBeInTheDocument();

    pendingUploads.mockResolvedValue({ success: true, data: { count: 1 } });
    await act(async () =>
      finish({
        success: true,
        data: {
          total: 3,
          uploadedScans: 1,
          failedScans: 1,
          stopped: true,
          errors: ['P2: Network down'],
        },
      })
    );

    const result = screen.getByTestId('upload-all-result');
    expect(result).toHaveTextContent(
      'Uploaded 1 of 3 scans. 1 failed and can be uploaded again. Stopped before the rest.'
    );
    expect(result).toHaveTextContent('P2: Network down');
    expect(onFinished).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId('upload-all-button')).toHaveTextContent(
        'Upload all (1)'
      )
    );
  });

  it('shows why a run could not start', async () => {
    uploadAll.mockResolvedValue({
      success: false,
      error: 'Bloom credentials are not set up on this computer',
    });
    renderBar();
    fireEvent.click(await screen.findByText('Upload all (3)'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't upload: Bloom credentials are not set up on this computer"
    );
  });
});
