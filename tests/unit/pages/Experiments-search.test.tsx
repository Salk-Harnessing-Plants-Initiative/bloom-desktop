/**
 * The Experiments page's search box: it narrows the experiment list by name, species,
 * scientist or accession file, and leaves the Attach picker offering every experiment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { Experiments } from '../../../src/renderer/Experiments';
import { WaveMetadataLinksProvider } from '../../../src/renderer/contexts/WaveMetadataLinksContext';

const ok = (data: unknown) =>
  vi.fn().mockResolvedValue({ success: true, data });

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  win.electron.database.experiments = {
    list: ok([
      {
        id: 'stl',
        name: '2026-11-10 STL Soy',
        species: 'Soybean',
        experiment_type: 'cylinderscan',
        scientist: { name: 'Wolfgang Busch' },
        accession: { id: 'acc-1', name: 'STL_soy_accessions.xlsx' },
      },
      {
        id: 'kcs',
        name: '2026-10-02 KCS Arabidopsis',
        species: 'Arabidopsis',
        experiment_type: 'cylinderscan',
        scientist: { name: 'Mina Kim' },
        accession: null,
      },
    ]),
    latestScans: ok([]),
    attachAccession: vi.fn(),
    listGraviMetadata: ok([]),
    linkGraviMetadata: vi.fn(),
    unlinkGraviMetadata: vi.fn(),
  };
  win.electron.database.graviPlateAccessions = { listFiles: ok([]) };
  win.electron.database.cylinderWaves = { list: ok([]) };
  win.electron.database.scientists = { list: ok([]) };
  win.electron.database.accessions = { list: ok([]) };
});

describe('Experiments search', () => {
  it('narrows the list as you search, but not the Attach picker', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter>
        <WaveMetadataLinksProvider>
          <Experiments mode="cylinderscan" />
        </WaveMetadataLinksProvider>
      </MemoryRouter>
    );
    const rows = () =>
      [...container.querySelectorAll('ul.experiments-list > li')].map(
        (li) => li.firstChild?.textContent
      );
    const box = () => screen.getByLabelText('Search experiments');
    await waitFor(() => expect(rows()).toHaveLength(2));

    await user.type(box(), 'mina');
    expect(rows()).toEqual([
      'Arabidopsis - 2026-10-02 KCS Arabidopsis (Mina Kim)',
    ]);
    expect(screen.getByTestId('search-count')).toHaveTextContent('1 of 2');
    // The Attach picker still offers both, after its placeholder.
    expect(
      (screen.getByLabelText(/Select Experiment/) as HTMLSelectElement).options
    ).toHaveLength(3);

    await user.clear(box());
    await user.type(box(), 'accessions.xlsx');
    expect(rows()).toEqual(['Soybean - 2026-11-10 STL Soy (Wolfgang Busch)']);

    await user.clear(box());
    await user.type(box(), 'canola');
    expect(
      screen.getByText('No experiments match this search')
    ).toBeInTheDocument();

    await user.clear(box());
    expect(rows()).toHaveLength(2);
    expect(screen.queryByTestId('search-count')).not.toBeInTheDocument();
  });
});
