/**
 * Browse Scans with Upload all running (#449): the rows refresh after each scan, and
 * single and selected uploads wait, so no scan is uploaded twice at once.
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
import { MemoryRouter } from 'react-router-dom';
import { BrowseScans } from '../../../src/renderer/BrowseScans';
import type {
  UploadAllDone,
  UploadAllProgress,
} from '../../../src/types/upload-all';

const scan = {
  id: 'scan-1',
  plant_id: 'PLANT-001',
  accession_name: 'Col-0',
  capture_date: '2026-02-17T10:30:00.000Z',
  experiment: { id: 'exp-1', name: 'Exp 1', species: 'Arabidopsis' },
  phenotyper: { id: 'phen-1', name: 'Jane' },
  wave_number: 1,
  plant_age_days: 14,
  images: [{ id: 'img-1', status: 'pending', path: 'f.png', frame_number: 1 }],
  scanner_name: 'Cam-A',
  exposure_time: 10000,
  gain: 100,
  brightness: 0.5,
  contrast: 1,
  gamma: 1,
  seconds_per_rot: 7,
};
const listResponse = (images = scan.images) => ({
  success: true,
  data: { scans: [{ ...scan, images }], total: 1, page: 1, pageSize: 25 },
});

let list: ReturnType<typeof vi.fn>;
let sendDone: (d: UploadAllDone) => void;
let sendProgress: (p: UploadAllProgress) => void;

beforeEach(() => {
  list = vi.fn().mockResolvedValue(listResponse());
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  win.electron = {
    ...win.electron,
    config: {
      ...win.electron?.config,
      get: vi.fn().mockResolvedValue({ config: { scans_dir: '/scans' } }),
    },
    database: {
      ...win.electron?.database,
      experiments: {
        list: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
      scans: {
        list,
        delete: vi.fn(),
        upload: vi.fn(),
        uploadBatch: vi.fn(),
        pendingUploads: vi
          .fn()
          .mockResolvedValue({ success: true, data: { count: 1 } }),
        uploadAll: vi
          .fn()
          .mockResolvedValue({ success: true, data: { total: 1 } }),
        stopUploadAll: vi.fn(),
        uploadAllStatus: vi.fn().mockResolvedValue({
          success: true,
          data: { running: false, progress: null, last: null },
        }),
        dismissUploadAllResult: vi.fn(),
        onUploadAllDone: (cb: (d: UploadAllDone) => void) => {
          sendDone = cb;
          return () => undefined;
        },
        onUploadAllProgress: (cb: (p: UploadAllProgress) => void) => {
          sendProgress = cb;
          return () => undefined;
        },
      },
    },
  };
});

async function startUploadAll() {
  render(
    <MemoryRouter>
      <BrowseScans />
    </MemoryRouter>
  );
  fireEvent.click(await screen.findByText('Upload all (1)'));
}

describe('Browse Scans while Upload all runs', () => {
  it('disables the row Upload and Upload Selected, and enables them again after', async () => {
    await startUploadAll();
    const rowUpload = screen.getByRole('button', { name: 'Upload to Bloom' });
    await waitFor(() => expect(rowUpload).toBeDisabled());
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(screen.getByText('Upload Selected (1)')).toBeDisabled();

    act(() =>
      sendDone({
        result: {
          total: 1,
          uploadedScans: 0,
          failedScans: 1,
          stopped: false,
          errors: [],
        },
      })
    );

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Upload to Bloom' })
      ).toBeEnabled()
    );
  });

  it('refreshes the rows after each scan, in place, without "Loading scans…"', async () => {
    await startUploadAll();
    const loadsBefore = list.mock.calls.length;
    list.mockResolvedValue(
      listResponse([{ ...scan.images[0], status: 'uploaded' }])
    );

    act(() =>
      sendProgress({ done: 1, total: 1, uploadedScans: 1, failedScans: 0 })
    );

    expect(screen.queryByText('Loading scans...')).not.toBeInTheDocument();
    await waitFor(() => expect(list.mock.calls.length).toBe(loadsBefore + 1));
    expect(await screen.findByText('All uploaded')).toBeInTheDocument();
  });

  it('ignores a slower reload from before the filters changed', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).electron.database.experiments.list = vi
      .fn()
      .mockResolvedValue({
        success: true,
        data: [{ id: 'exp-2', name: 'Exp 2', species: 'Arabidopsis' }],
      });
    await startUploadAll();
    await screen.findByRole('option', { name: /Exp 2/ });
    let answerOldReload: (value: unknown) => void = () => undefined;
    list.mockReturnValueOnce(
      new Promise((resolve) => (answerOldReload = resolve))
    );
    act(() =>
      sendProgress({ done: 1, total: 2, uploadedScans: 1, failedScans: 0 })
    );

    list.mockResolvedValue({
      success: true,
      data: {
        scans: [{ ...scan, id: 'scan-2', plant_id: 'NEW-FILTER' }],
        total: 1,
        page: 1,
        pageSize: 25,
      },
    });
    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 'exp-2' },
    });
    expect(await screen.findByText('NEW-FILTER')).toBeInTheDocument();

    await act(async () => answerOldReload(listResponse()));

    expect(screen.getByText('NEW-FILTER')).toBeInTheDocument();
    expect(screen.queryByText('PLANT-001')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading scans...')).not.toBeInTheDocument();
  });

  it('greys out Upload all while a single scan is uploading', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).electron.database.scans.upload = vi.fn(
      () => new Promise(() => undefined)
    );
    render(
      <MemoryRouter>
        <BrowseScans />
      </MemoryRouter>
    );
    await screen.findByText('Upload all (1)');
    fireEvent.click(screen.getByRole('button', { name: 'Upload to Bloom' }));

    await waitFor(() =>
      expect(screen.getByTestId('upload-all-button')).toBeDisabled()
    );
  });
});
