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
import type {
  UploadAllDone,
  UploadAllProgress,
  UploadAllStatus,
} from '../../../src/types/upload-all';

const pendingUploads = vi.fn();
const uploadAll = vi.fn();
const stopUploadAll = vi.fn();
const uploadAllStatus = vi.fn();
const dismissUploadAllResult = vi.fn();
let sendProgress: (p: UploadAllProgress) => void = () => undefined;
let sendDone: (d: UploadAllDone) => void = () => undefined;

const idle: UploadAllStatus = { running: false, progress: null, last: null };
const result = (over = {}) => ({
  total: 3,
  uploadedScans: 3,
  failedScans: 0,
  stopped: false,
  errors: [] as string[],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  pendingUploads.mockResolvedValue({ success: true, data: { count: 3 } });
  uploadAll.mockResolvedValue({ success: true, data: { total: 3 } });
  stopUploadAll.mockResolvedValue({ success: true });
  uploadAllStatus.mockResolvedValue({ success: true, data: idle });
  dismissUploadAllResult.mockResolvedValue({ success: true });
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
        uploadAllStatus,
        dismissUploadAllResult,
        onUploadAllProgress: (cb: (p: UploadAllProgress) => void) => {
          sendProgress = cb;
          return () => (sendProgress = () => undefined);
        },
        onUploadAllDone: (cb: (d: UploadAllDone) => void) => {
          sendDone = cb;
          return () => (sendDone = () => undefined);
        },
      },
    },
  };
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

const filters = { experimentId: 'exp-1', dateFrom: '2026-10-01', dateTo: '' };

function renderBar(props: Partial<Parameters<typeof UploadAllBar>[0]> = {}) {
  const onFinished = vi.fn();
  const utils = render(
    <UploadAllBar
      filters={filters}
      refreshKey={1}
      onFinished={onFinished}
      {...props}
    />
  );
  return { onFinished, ...utils };
}

async function start() {
  fireEvent.click(await screen.findByText('Upload all (3)'));
  await screen.findByTestId('upload-all-stop');
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
    expect(screen.getByTestId('upload-all-button')).toHaveTextContent(
      'Nothing to upload'
    );
    expect(screen.getByTestId('upload-all-button')).toBeDisabled();
  });

  it('says so when the count fails, instead of "Checking…" for ever', async () => {
    pendingUploads.mockResolvedValue({
      success: false,
      error: 'database is locked',
    });
    renderBar();
    expect(
      await screen.findByText("Couldn't check for scans to upload.")
    ).toBeInTheDocument();
  });

  it('asks first, and does nothing when the answer is no', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    renderBar();
    fireEvent.click(await screen.findByText('Upload all (3)'));
    expect(window.confirm).toHaveBeenCalledWith('Upload 3 scans to Bloom?');
    expect(uploadAll).not.toHaveBeenCalled();
  });

  it('shows progress, can stop, and reports the result when the run ends', async () => {
    const onProgress = vi.fn();
    const { onFinished } = renderBar({ onProgress });
    await start();
    expect(uploadAll).toHaveBeenCalledWith(filters);

    act(() =>
      sendProgress({ done: 1, total: 3, uploadedScans: 1, failedScans: 0 })
    );
    expect(screen.getByTestId('upload-all-status')).toHaveTextContent(
      'Uploading 2 of 3…'
    );
    expect(onProgress).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('upload-all-stop'));
    expect(stopUploadAll).toHaveBeenCalled();
    expect(
      await screen.findByText('Stopping after this scan…')
    ).toBeInTheDocument();

    pendingUploads.mockResolvedValue({ success: true, data: { count: 1 } });
    act(() =>
      sendDone({
        result: result({
          uploadedScans: 1,
          failedScans: 1,
          stopped: true,
          errors: ['P2: Network down'],
        }),
      })
    );

    expect(screen.getByTestId('upload-all-result')).toHaveTextContent(
      'Uploaded 1 of 3 scans. 1 failed and can be uploaded again. Stopped before the rest.'
    );
    expect(screen.getByTestId('upload-all-result')).toHaveTextContent(
      'P2: Network down'
    );
    expect(onFinished).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId('upload-all-button')).toHaveTextContent(
        'Upload all (1)'
      )
    );
  });

  it('tells the page when a run starts and ends', async () => {
    const onRunningChange = vi.fn();
    renderBar({ onRunningChange });
    await start();
    expect(onRunningChange).toHaveBeenLastCalledWith(true);
    act(() => sendDone({ result: result() }));
    expect(onRunningChange).toHaveBeenLastCalledWith(false);
  });

  it('reloads the page as it is when the run ends, even if its filters changed during it', async () => {
    const reloadOld = vi.fn();
    const reloadNew = vi.fn();
    const { rerender } = render(
      <UploadAllBar filters={filters} refreshKey={1} onFinished={reloadOld} />
    );
    await start();
    rerender(
      <UploadAllBar
        filters={{ experimentId: 'exp-2' }}
        refreshKey={2}
        onFinished={reloadNew}
      />
    );
    act(() => sendDone({ result: result() }));
    expect(reloadNew).toHaveBeenCalled();
    expect(reloadOld).not.toHaveBeenCalled();
  });

  it('remembers a run going on when the page is opened again: progress, Stop and the end', async () => {
    uploadAllStatus.mockResolvedValue({
      success: true,
      data: {
        running: true,
        progress: { done: 4, total: 10, uploadedScans: 4, failedScans: 0 },
        last: null,
      },
    });
    const onRunningChange = vi.fn();
    renderBar({ onRunningChange });

    expect(await screen.findByText('Uploading 5 of 10…')).toBeInTheDocument();
    expect(screen.getByTestId('upload-all-stop')).toBeEnabled();
    expect(onRunningChange).toHaveBeenLastCalledWith(true);

    act(() => sendDone({ result: result({ total: 10, uploadedScans: 10 }) }));
    expect(screen.getByTestId('upload-all-result')).toHaveTextContent(
      'Uploaded 10 of 10 scans.'
    );
  });

  it("shows how the last run ended when the page is opened after it, until it's closed", async () => {
    uploadAllStatus.mockResolvedValue({
      success: true,
      data: {
        running: false,
        progress: null,
        last: { result: result({ failedScans: 1, uploadedScans: 2 }) },
      },
    });
    renderBar();

    expect(
      await screen.findByText(/Uploaded 2 of 3 scans\. 1 failed/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('upload-all-dismiss'));
    expect(screen.queryByTestId('upload-all-result')).not.toBeInTheDocument();
    expect(dismissUploadAllResult).toHaveBeenCalled();
  });

  it('shows why a run could not start, or why it ended early', async () => {
    uploadAll.mockResolvedValueOnce({
      success: false,
      error: 'An upload is already running.',
    });
    renderBar();
    fireEvent.click(await screen.findByText('Upload all (3)'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't upload: An upload is already running."
    );

    await start();
    act(() =>
      sendDone({ error: 'Bloom credentials are not set up on this computer' })
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't upload: Bloom credentials are not set up on this computer"
    );
  });

  it('is greyed out while another upload is in progress on the page', async () => {
    renderBar({ disabled: true });
    await screen.findByText('3 scans not yet uploaded');
    expect(screen.getByTestId('upload-all-button')).toBeDisabled();
  });
});
