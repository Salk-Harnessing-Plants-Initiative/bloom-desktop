/**
 * Unit Tests: Export Scans' search (#471): one box over experiment, phenotyper, plant
 * barcode and dates typed like "Nov 20, 2026", and a From/To range on the same line.
 * The list, its counts and "select all" follow them; the selection is kept.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { Export } from '../../../src/renderer/Export';
import { mockScans, type MockScan } from '../helpers/export-scans-mock';

const NAMES = { stl: '2026-11-10 STL Soy', kcs: 'KCS-drought-2025' };
const PEOPLE = { emily: 'Emily Smith', ana: 'Ana Lopez' };

const scan = (
  id: string,
  experiment: keyof typeof NAMES,
  capture_date: Date,
  phenotyper: keyof typeof PEOPLE,
  plant_id = `PLANT-${id}`
): MockScan => ({
  id,
  experiment_id: experiment,
  plant_id,
  capture_date,
  scanner_name: 'SlowScanner',
  experiment: { name: NAMES[experiment] },
  phenotyper_name: PEOPLE[phenotyper],
});

const SCANS = [
  scan('s1', 'stl', new Date(2026, 10, 20, 11, 27), 'emily', 'ECQM33-005-1-10'),
  scan('s2', 'stl', new Date(2026, 10, 20, 11, 24), 'ana', 'ECQM33-001-1-2'),
  scan('s3', 'stl', new Date(2026, 10, 19, 9), 'emily', 'WT-SEM-3'),
  scan('k1', 'kcs', new Date(2025, 10, 20, 10), 'ana', 'KCS-1'),
  scan('k2', 'kcs', new Date(2025, 5, 2, 10), 'emily', 'KCS-2'),
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let api: any;

beforeEach(() => {
  api = mockScans(window, SCANS);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).electron.database.scans.onExportProgress = vi
    .fn()
    .mockReturnValue(vi.fn());
});

const experimentRows = () =>
  screen
    .getAllByRole('button', { name: new RegExp(`${NAMES.stl}|${NAMES.kcs}`) })
    .map((b) => b.textContent);
const searchBox = () => screen.getByRole('searchbox', { name: 'Search scans' });
const summary = () => screen.getByTestId('filter-summary');

async function search(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.clear(searchBox());
  await user.type(searchBox(), text);
}

describe('Export Scans search', () => {
  it('searches by phenotyper name, counting only their scans', async () => {
    const user = userEvent.setup();
    render(<Export />);
    await screen.findByText(NAMES.stl);

    await search(user, 'emi');
    await waitFor(() =>
      expect(summary()).toHaveTextContent(
        'Showing 2 experiments · 3 of 5 scans'
      )
    );
    expect(api.experimentCounts).toHaveBeenLastCalledWith({ search: 'emi' });
    const stl = screen.getByRole('button', { name: NAMES.stl }).parentElement!;
    expect(within(stl).getByText('2 scans')).toBeInTheDocument();
  });

  it('waits for typing to pause before searching', async () => {
    const user = userEvent.setup();
    render(<Export />);
    await screen.findByText(NAMES.stl);
    const calls = api.experimentCounts.mock.calls.length;

    await user.type(searchBox(), 'ecqm');
    await waitFor(() =>
      expect(api.experimentCounts).toHaveBeenCalledTimes(calls + 1)
    );
    expect(api.experimentCounts).toHaveBeenLastCalledWith({ search: 'ecqm' });
  });

  it('searches by plant barcode and opens to the matching scan only', async () => {
    const user = userEvent.setup();
    render(<Export />);
    await screen.findByText(NAMES.stl);

    await search(user, '005-1-10');
    await waitFor(() => expect(experimentRows()).toEqual([NAMES.stl]));
    await user.click(screen.getByRole('button', { name: NAMES.stl }));
    await user.click(
      await screen.findByRole('button', { name: 'Nov 20, 2026' })
    );
    expect(await screen.findByText('ECQM33-005-1-10')).toBeInTheDocument();
    expect(screen.queryByText('ECQM33-001-1-2')).not.toBeInTheDocument();
  });

  it('searches by a date typed as the page shows it, and by part of one', async () => {
    const user = userEvent.setup();
    render(<Export />);
    await screen.findByText(NAMES.stl);

    await search(user, 'Nov 20, 2026');
    await waitFor(() =>
      expect(summary()).toHaveTextContent('1 experiment · 2 of 5 scans')
    );
    await search(user, 'nov 20');
    await waitFor(() =>
      expect(summary()).toHaveTextContent('2 experiments · 3 of 5 scans')
    );
    await search(user, 'Nov 2026');
    await waitFor(() =>
      expect(summary()).toHaveTextContent('1 experiment · 3 of 5 scans')
    );
  });

  it('ticking a searched experiment selects only its matching scans, and the selection is kept', async () => {
    const user = userEvent.setup();
    render(<Export />);
    await screen.findByText(NAMES.stl);

    await search(user, 'emily');
    await waitFor(() => expect(summary()).toHaveTextContent('3 of 5 scans'));
    await user.click(
      screen.getByRole('checkbox', { name: `Select all scans in ${NAMES.stl}` })
    );
    await waitFor(() =>
      expect(screen.getByText('2 scans selected')).toBeInTheDocument()
    );

    await search(user, 'ana');
    await waitFor(() => expect(summary()).toHaveTextContent('2 of 5 scans'));
    await user.click(
      screen.getByRole('checkbox', { name: `Select all scans in ${NAMES.kcs}` })
    );
    await waitFor(() =>
      expect(screen.getByText('3 scans selected')).toBeInTheDocument()
    );
  });

  it('filters by a From/To range, with the search too', async () => {
    const user = userEvent.setup();
    render(<Export />);
    await screen.findByText(NAMES.stl);

    await user.type(screen.getByLabelText('From date'), '2026-11-01');
    await user.type(screen.getByLabelText('To date'), '2026-11-30');
    await waitFor(() =>
      expect(summary()).toHaveTextContent('1 experiment · 3 of 5 scans')
    );
    expect(api.experimentCounts).toHaveBeenLastCalledWith({
      dateFrom: '2026-11-01',
      dateTo: '2026-11-30',
    });

    await search(user, 'emily');
    await waitFor(() =>
      expect(summary()).toHaveTextContent('1 experiment · 2 of 5 scans')
    );
  });

  it('says when nothing matches, and Clear brings everything back', async () => {
    const user = userEvent.setup();
    render(<Export />);
    await screen.findByText(NAMES.stl);

    await search(user, 'nothing like this');
    await user.type(screen.getByLabelText('From date'), '2026-11-01');
    expect(
      await screen.findByText('No scans match this search')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.getByLabelText('From date')).toHaveValue('');
    expect(searchBox()).toHaveValue('');
    await waitFor(() =>
      expect(experimentRows()).toEqual([NAMES.stl, NAMES.kcs])
    );
    expect(screen.queryByTestId('filter-summary')).not.toBeInTheDocument();
  });
});
