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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = global.window as any;
    win.electron.database.graviPlateAccessions = {
      listFiles,
      list,
      delete: deleteFile,
    };
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

  it('removes the entry on a successful delete', async () => {
    listFiles.mockResolvedValue({ success: true, data: [makeFile()] });
    const user = userEvent.setup();
    render(<GraviMetadataList />);
    await waitFor(() => screen.getByText('batch3.xlsx'));

    await user.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => {
      expect(screen.queryByText('batch3.xlsx')).not.toBeInTheDocument();
    });
  });
});
