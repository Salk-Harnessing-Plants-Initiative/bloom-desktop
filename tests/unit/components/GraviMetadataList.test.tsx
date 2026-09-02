import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GraviMetadataList } from '../../../src/renderer/components/GraviMetadataList';

// createdAt is a real Date instance here, not a string: Electron's IPC
// structured clone preserves Date objects, matching what the main process
// actually sends (Prisma's DateTime maps to Date).
function makeFile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    name: 'batch3.xlsx',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    plateCount: 2,
    experimentNames: ['Drought Study'],
    ...overrides,
  };
}

describe('GraviMetadataList', () => {
  let listFiles: ReturnType<typeof vi.fn>;
  let list: ReturnType<typeof vi.fn>;
  let deleteFile: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listFiles = vi.fn().mockResolvedValue({ success: true, data: [] });
    list = vi.fn().mockResolvedValue({
      success: true,
      data: [
        {
          plate_id: 'P1',
          accession: 'Col-0',
          transplant_date: new Date('2026-07-01T00:00:00.000Z'),
          custom_note: 'note',
          sections: [
            { plate_section_id: 'S1', plant_qr: 'QR1', medium: 'Soil' },
          ],
        },
      ],
    });
    deleteFile = vi.fn().mockResolvedValue({ success: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = global.window as any;
    win.electron.database.graviPlateAccessions = {
      listFiles,
      list,
      delete: deleteFile,
    };
  });

  it('shows a loading message while the initial file list fetch is in flight', async () => {
    let resolveListFiles: (value: {
      success: boolean;
      data: unknown[];
    }) => void = () => {};
    listFiles.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveListFiles = resolve;
        })
    );
    render(<GraviMetadataList />);

    expect(screen.getByText(/loading metadata files/i)).toBeInTheDocument();

    resolveListFiles({ success: true, data: [] });
    await waitFor(() => {
      expect(
        screen.queryByText(/loading metadata files/i)
      ).not.toBeInTheDocument();
    });
  });

  it('surfaces an error when the file list fetch fails, instead of an empty-state message', async () => {
    listFiles.mockResolvedValue({
      success: false,
      error: 'Could not reach database',
    });
    render(<GraviMetadataList />);

    await waitFor(() => {
      expect(screen.getByText('Could not reach database')).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/no graviscan metadata uploaded yet/i)
    ).not.toBeInTheDocument();
  });

  it('falls back to a default message when the file list fetch fails with no error field', async () => {
    listFiles.mockResolvedValue({ success: false });
    render(<GraviMetadataList />);

    await waitFor(() => {
      expect(
        screen.getByText(/failed to load metadata files/i)
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/no graviscan metadata uploaded yet/i)
    ).not.toBeInTheDocument();
  });

  it('surfaces an error when the file list fetch rejects outright, not just resolves with success: false', async () => {
    listFiles.mockRejectedValue(new Error('IPC channel closed'));
    render(<GraviMetadataList />);

    await waitFor(() => {
      expect(screen.getByText('IPC channel closed')).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/no graviscan metadata uploaded yet/i)
    ).not.toBeInTheDocument();
  });

  it('shows an empty-state message when there are no metadata files', async () => {
    listFiles.mockResolvedValue({ success: true, data: [] });
    render(<GraviMetadataList />);

    await waitFor(() => {
      expect(
        screen.getByText(/no graviscan metadata uploaded yet/i)
      ).toBeInTheDocument();
    });
  });

  it('surfaces an error when expanding fails to fetch plates, without rendering an empty table', async () => {
    listFiles.mockResolvedValue({ success: true, data: [makeFile()] });
    list.mockResolvedValue({ success: false, error: 'Failed to load plates' });
    const user = userEvent.setup();
    render(<GraviMetadataList />);
    await waitFor(() => screen.getByText('batch3.xlsx'));

    await user.click(screen.getByText('batch3.xlsx'));

    await waitFor(() => {
      expect(screen.getByText('Failed to load plates')).toBeInTheDocument();
    });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('surfaces an error when the expand fetch rejects outright, not just resolves with success: false', async () => {
    listFiles.mockResolvedValue({ success: true, data: [makeFile()] });
    list.mockRejectedValue(new Error('IPC channel closed'));
    const user = userEvent.setup();
    render(<GraviMetadataList />);
    await waitFor(() => screen.getByText('batch3.xlsx'));

    await user.click(screen.getByText('batch3.xlsx'));

    await waitFor(() => {
      expect(screen.getByText('IPC channel closed')).toBeInTheDocument();
    });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('falls back to a default message when expanding fails with no error field', async () => {
    listFiles.mockResolvedValue({ success: true, data: [makeFile()] });
    list.mockResolvedValue({ success: false });
    const user = userEvent.setup();
    render(<GraviMetadataList />);
    await waitFor(() => screen.getByText('batch3.xlsx'));

    await user.click(screen.getByText('batch3.xlsx'));

    await waitFor(() => {
      expect(
        screen.getByText(/failed to load plate data/i)
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('clears a stale expand error as soon as a retry attempt starts, not just once the retry resolves', async () => {
    listFiles.mockResolvedValue({ success: true, data: [makeFile()] });
    list.mockResolvedValue({ success: false, error: 'Failed to load plates' });
    const user = userEvent.setup();
    render(<GraviMetadataList />);
    await waitFor(() => screen.getByText('batch3.xlsx'));

    // First attempt fails.
    await user.click(screen.getByText('batch3.xlsx'));
    await waitFor(() => {
      expect(screen.getByText('Failed to load plates')).toBeInTheDocument();
    });

    // Collapse, then retry with a promise that doesn't resolve immediately
    // — the stale error must disappear as soon as the retry starts, not
    // linger for the whole in-flight window.
    await user.click(screen.getByText('batch3.xlsx'));
    let resolveRetry: (value: {
      success: boolean;
      data?: unknown[];
    }) => void = () => {};
    list.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRetry = resolve;
        })
    );
    await user.click(screen.getByText('batch3.xlsx'));

    expect(screen.queryByText('Failed to load plates')).not.toBeInTheDocument();

    resolveRetry({
      success: true,
      data: [{ plate_id: 'P1', accession: 'Col-0', sections: [] }],
    });
    await waitFor(() => screen.getByRole('table'));
  });

  it('lists files with name, date, linked experiments, and plate count, chronologically, no filter/sort UI', async () => {
    listFiles.mockResolvedValue({ success: true, data: [makeFile()] });
    render(<GraviMetadataList />);

    await waitFor(() => {
      expect(screen.getByText('batch3.xlsx')).toBeInTheDocument();
    });
    expect(screen.getByText(/drought study/i)).toBeInTheDocument();
    expect(screen.getByText(/2 plates/i)).toBeInTheDocument();
    expect(screen.getByText('2026-08-01T00:00:00.000Z')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: /sort/i })
    ).not.toBeInTheDocument();
  });

  it('expands a row to lazily fetch and render plates/sections', async () => {
    listFiles.mockResolvedValue({ success: true, data: [makeFile()] });
    const user = userEvent.setup();
    render(<GraviMetadataList />);
    await waitFor(() => screen.getByText('batch3.xlsx'));

    expect(list).not.toHaveBeenCalled();
    await user.click(screen.getByText('batch3.xlsx'));

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith('file-1');
    });
    expect(screen.getByText('S1')).toBeInTheDocument();
    expect(screen.getByText('QR1')).toBeInTheDocument();
    expect(screen.getByText('2026-07-01T00:00:00.000Z')).toBeInTheDocument();
  });

  it('renders a header row on the expanded plate/section table with the 7 expected columns, in order', async () => {
    listFiles.mockResolvedValue({ success: true, data: [makeFile()] });
    const user = userEvent.setup();
    render(<GraviMetadataList />);
    await waitFor(() => screen.getByText('batch3.xlsx'));

    await user.click(screen.getByText('batch3.xlsx'));
    await waitFor(() => screen.getByRole('table'));

    const headers = screen
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers).toEqual([
      'Plate ID',
      'Accession',
      'Transplant Date',
      'Custom Note',
      'Section',
      'Plant QR',
      'Medium',
    ]);
  });

  it('surfaces the blocked-deletion error without removing the entry', async () => {
    listFiles.mockResolvedValue({ success: true, data: [makeFile()] });
    deleteFile.mockResolvedValue({
      success: false,
      error: 'File is still referenced by an experiment',
    });
    const user = userEvent.setup();
    render(<GraviMetadataList />);
    await waitFor(() => screen.getByText('batch3.xlsx'));

    await user.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/still referenced by an experiment/i)
      ).toBeInTheDocument();
    });
    expect(screen.getByText('batch3.xlsx')).toBeInTheDocument();
  });

  it('removes the entry on a successful delete after confirmation', async () => {
    listFiles.mockResolvedValue({ success: true, data: [makeFile()] });
    const user = userEvent.setup();
    render(<GraviMetadataList />);
    await waitFor(() => screen.getByText('batch3.xlsx'));

    await user.click(screen.getByRole('button', { name: /delete/i }));

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('batch3.xlsx')
    );
    await waitFor(() => {
      expect(screen.queryByText('batch3.xlsx')).not.toBeInTheDocument();
    });
  });

  it('does not delete when the confirmation dialog is declined', async () => {
    listFiles.mockResolvedValue({ success: true, data: [makeFile()] });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<GraviMetadataList />);
    await waitFor(() => screen.getByText('batch3.xlsx'));

    await user.click(screen.getByRole('button', { name: /delete/i }));

    expect(deleteFile).not.toHaveBeenCalled();
    expect(screen.getByText('batch3.xlsx')).toBeInTheDocument();
  });
});
