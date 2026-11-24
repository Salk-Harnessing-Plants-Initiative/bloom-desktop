/**
 * The Accessions page (#512 follow-up): Browse Accession Files above Upload Accession
 * File, newest first, a search over file names, plant barcodes and accession names,
 * an edit note, and no name-only Add New Accession form.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Accessions } from '../../../src/renderer/Accessions';

const FILES = [
  { id: 'alf', name: 'Alfalfa_pilot.xlsx', createdAt: '2025-03-19T10:00:00Z' },
  {
    id: 'stl',
    name: 'STL_soy_accessions.xlsx',
    createdAt: '2026-11-09T10:00:00Z',
  },
  { id: 'kcs', name: 'KCS_lines.xlsx', createdAt: '2026-10-01T10:00:00Z' },
];

let search: ReturnType<typeof vi.fn>;

beforeEach(() => {
  search = vi.fn((text: string) => {
    const t = text.toLowerCase();
    const data = t.includes('stl-003')
      ? [{ accession_file_id: 'stl', matching_plants: 1 }]
      : t.includes('col-0')
        ? [
            { accession_file_id: 'kcs', matching_plants: 4 },
            { accession_file_id: 'stl', matching_plants: 1 },
          ]
        : [];
    return Promise.resolve({ success: true, data });
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  win.electron.database.experiments = {
    latestScans: vi.fn().mockResolvedValue({ success: true, data: [] }),
  };
  win.electron.database.accessions = {
    list: vi.fn().mockResolvedValue({ success: true, data: FILES }),
    search,
    getMappings: vi.fn().mockResolvedValue({ success: true, data: [] }),
    createWithMappings: vi.fn(),
  };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <Accessions />
    </MemoryRouter>
  );
}

const fileNames = () =>
  screen
    .queryAllByTestId('accession-item')
    .map((item) => within(item).getByText(/\.xlsx$/).textContent);
const box = () => screen.getByLabelText('Search accession files');

describe('Accessions page', () => {
  it('shows Browse Accession Files above Upload Accession File, with the edit note and no Add form', async () => {
    renderPage();
    await screen.findByText('STL_soy_accessions.xlsx');
    const browse = screen.getByRole('heading', {
      name: 'Browse Accession Files',
    });
    const upload = screen.getByRole('heading', {
      name: 'Upload Accession File',
    });
    expect(
      browse.compareDocumentPosition(upload) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen.getByText(
        "You can edit your files here: rename a file, change a plant's accession, or delete a file."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText('Add New Accession')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add Accession' })
    ).not.toBeInTheDocument();
    // The list fills the spare height and scrolls.
    expect(screen.getByTestId('accession-files')).toHaveClass(
      'flex-1',
      'overflow-auto'
    );
  });

  it('lists the newest uploaded file first', async () => {
    renderPage();
    await screen.findByText('STL_soy_accessions.xlsx');
    expect(fileNames()).toEqual([
      'STL_soy_accessions.xlsx',
      'KCS_lines.xlsx',
      'Alfalfa_pilot.xlsx',
    ]);
  });

  it('finds files by name, in any case, without waiting for the plant search', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('STL_soy_accessions.xlsx');
    await user.type(box(), 'kcs');
    expect(fileNames()).toEqual(['KCS_lines.xlsx']);
    await waitFor(() =>
      expect(screen.getByTestId('search-count')).toHaveTextContent(
        '1 of 3 files'
      )
    );
  });

  it('finds the file holding a plant barcode, and says how many plants match', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('STL_soy_accessions.xlsx');
    await user.type(box(), 'STL-003');
    await waitFor(() =>
      expect(fileNames()).toEqual(['STL_soy_accessions.xlsx'])
    );
    expect(screen.getByTestId('plant-matches-stl')).toHaveTextContent(
      '1 plant matches'
    );
  });

  it('finds files by accession name, with plant counts', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('STL_soy_accessions.xlsx');
    await user.type(box(), 'col-0');
    await waitFor(() =>
      expect(fileNames()).toEqual(['STL_soy_accessions.xlsx', 'KCS_lines.xlsx'])
    );
    expect(screen.getByTestId('plant-matches-kcs')).toHaveTextContent(
      '4 plants match'
    );
    expect(screen.getByTestId('search-count')).toHaveTextContent(
      '2 of 3 files'
    );
  });

  it('searches the plants once typing pauses, not on every key', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('STL_soy_accessions.xlsx');
    await user.type(box(), 'stl-003');
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith('stl-003');
  });

  it('drops an answer for text the user has since changed', async () => {
    let answerOld: () => void = () => {};
    search.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerOld = () =>
            resolve({
              success: true,
              data: [{ accession_file_id: 'alf', matching_plants: 9 }],
            });
        })
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('STL_soy_accessions.xlsx');
    await user.type(box(), 'zzz');
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await user.clear(box());
    await user.type(box(), 'stl-003');
    await waitFor(() =>
      expect(fileNames()).toEqual(['STL_soy_accessions.xlsx'])
    );
    answerOld();
    await new Promise((r) => setTimeout(r, 50));
    expect(fileNames()).toEqual(['STL_soy_accessions.xlsx']);
  });

  it('says when nothing matches, and clearing shows every file again', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('STL_soy_accessions.xlsx');
    await user.type(box(), 'nothing like this');
    expect(
      await screen.findByText('No accession files match this search')
    ).toBeInTheDocument();
    await user.clear(box());
    expect(fileNames()).toHaveLength(3);
    expect(screen.queryByTestId('search-count')).not.toBeInTheDocument();
  });

  it('keeps searching file names when the plant search fails, and says so', async () => {
    search.mockResolvedValue({ success: false, error: 'database is locked' });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('STL_soy_accessions.xlsx');
    await user.type(box(), 'kcs');
    expect(
      await screen.findByText(/couldn.t be searched: database is locked/)
    ).toBeInTheDocument();
    expect(fileNames()).toEqual(['KCS_lines.xlsx']);
  });
});
