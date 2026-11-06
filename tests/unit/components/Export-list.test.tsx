/**
 * Unit Tests: Export Scans' experiment → day → scan list (#436). The page opens with
 * experiments only, loads a row when it's opened or ticked, and searches by name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { Export } from '../../../src/renderer/Export';
import { mockScans, type MockScan } from '../helpers/export-scans-mock';

const scan = (
  id: string,
  experiment: 'kcs' | 'weep' | 'alf',
  capture_date: Date
): MockScan => ({
  id,
  experiment_id: experiment,
  plant_id: `PLANT-${id}`,
  capture_date,
  scanner_name: 'Station-A',
  experiment: {
    name: {
      kcs: 'KCS-drought-2026',
      weep: 'weep6-MBZ-Interaction-EXP1',
      alf: 'Alfalfa-wave3',
    }[experiment],
  },
});

const OCT_28 = new Date(2026, 9, 28, 10);
const NOV_4 = new Date(2026, 10, 4, 9);

const SCANS = [
  scan('w1', 'weep', OCT_28),
  scan('w2', 'weep', new Date(2026, 9, 28, 11)),
  scan('w3', 'weep', NOV_4),
  scan('k1', 'kcs', OCT_28),
  scan('a1', 'alf', OCT_28),
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

const box = (name: string) => screen.getByRole('checkbox', { name });
const open = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole('button', { name }));
const selectedCount = (text: string) =>
  waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());

describe('Export Scans list', () => {
  it('opens with collapsed experiments and their counts, sorted by name, loading no scans', async () => {
    render(<Export />);

    const rows = await screen.findAllByRole('button', { expanded: false });
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Alfalfa-wave3'),
      expect.stringContaining('KCS-drought-2026'),
      expect.stringContaining('weep6-MBZ-Interaction-EXP1'),
    ]);
    expect(screen.getByText('3 scans')).toBeInTheDocument();
    expect(api.experimentDays).not.toHaveBeenCalled();
    expect(api.list).not.toHaveBeenCalled();
  });

  it('opening an experiment loads only its days; opening a day loads only its scans', async () => {
    const user = userEvent.setup();
    render(<Export />);
    await screen.findByText('weep6-MBZ-Interaction-EXP1');

    await open(user, 'weep6-MBZ-Interaction-EXP1');
    expect(await screen.findByText('Nov 4, 2026')).toBeInTheDocument();
    const days = screen.getAllByRole('button', {
      name: /^[A-Z][a-z]{2} \d{1,2}, 2026$/,
    });
    expect(days.map((d) => d.textContent)).toEqual([
      expect.stringContaining('Nov 4, 2026'),
      expect.stringContaining('Oct 28, 2026'),
    ]);
    expect(api.experimentDays).toHaveBeenCalledTimes(1);
    expect(api.experimentDays).toHaveBeenCalledWith('weep');
    expect(api.list).not.toHaveBeenCalled();

    await open(user, 'Oct 28, 2026');
    expect(await screen.findByText('PLANT-w1')).toBeInTheDocument();
    expect(screen.getByText('PLANT-w2')).toBeInTheDocument();
    expect(screen.queryByText('PLANT-w3')).not.toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.list).toHaveBeenCalledWith({
      page: 1,
      pageSize: 1000,
      experimentId: 'weep',
      dateFrom: '2026-10-28',
      dateTo: '2026-10-28',
      summary: true,
    });
  });

  it('keeps opened rows loaded when they are closed and reopened', async () => {
    const user = userEvent.setup();
    render(<Export />);
    await screen.findByText('weep6-MBZ-Interaction-EXP1');

    await open(user, 'weep6-MBZ-Interaction-EXP1');
    await open(user, 'Oct 28, 2026');
    await screen.findByText('PLANT-w1');
    await open(user, 'weep6-MBZ-Interaction-EXP1');
    expect(screen.queryByText('PLANT-w1')).not.toBeInTheDocument();
    await open(user, 'weep6-MBZ-Interaction-EXP1');

    expect(screen.getByText('PLANT-w1')).toBeInTheDocument();
    expect(api.experimentDays).toHaveBeenCalledTimes(1);
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('ticking an unopened experiment loads and selects all its scans; unticking clears them', async () => {
    const user = userEvent.setup();
    render(<Export />);
    await screen.findByText('weep6-MBZ-Interaction-EXP1');

    await user.click(box('Select all scans in weep6-MBZ-Interaction-EXP1'));
    await selectedCount('3 scans selected');
    expect(box('Select all scans in weep6-MBZ-Interaction-EXP1')).toBeChecked();

    await user.click(box('Select all scans in weep6-MBZ-Interaction-EXP1'));
    await selectedCount('0 scans selected');
  });

  it('a day and its experiment show some selected (a dash), then all', async () => {
    const user = userEvent.setup();
    render(<Export />);
    await screen.findByText('weep6-MBZ-Interaction-EXP1');
    await open(user, 'weep6-MBZ-Interaction-EXP1');
    await screen.findByText('Oct 28, 2026');

    await user.click(box('Select all scans on Oct 28, 2026'));
    await selectedCount('2 scans selected');
    const experiment = box(
      'Select all scans in weep6-MBZ-Interaction-EXP1'
    ) as HTMLInputElement;
    expect(box('Select all scans on Oct 28, 2026')).toBeChecked();
    expect(experiment.checked).toBe(false);
    expect(experiment.indeterminate).toBe(true);

    await open(user, 'Oct 28, 2026');
    await user.click(await screen.findByRole('checkbox', { name: /PLANT-w1/ }));
    await selectedCount('1 scan selected');
    const day = box('Select all scans on Oct 28, 2026') as HTMLInputElement;
    expect(day.checked).toBe(false);
    expect(day.indeterminate).toBe(true);

    await user.click(box('Select all scans on Nov 4, 2026'));
    await user.click(screen.getByRole('checkbox', { name: /PLANT-w1/ }));
    await selectedCount('3 scans selected');
    expect(experiment.checked).toBe(true);
    expect(experiment.indeterminate).toBe(false);
  });

  it('waits to export while a ticked experiment is still loading its scans', async () => {
    const user = userEvent.setup();
    let answer: (value: unknown) => void = () => {};
    const days = api.experimentDays.getMockImplementation();
    // Only weep6's days wait; the others answer at once.
    api.experimentDays.mockImplementation((id: string) =>
      id === 'weep'
        ? new Promise((resolve) => {
            answer = resolve;
          })
        : days(id)
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).electron.config.browseDirectory = vi
      .fn()
      .mockResolvedValue('/fake/destination');
    render(<Export />);
    await screen.findByText('weep6-MBZ-Interaction-EXP1');
    await user.click(
      screen.getByRole('button', { name: 'Choose Destination' })
    );
    await screen.findByText('/fake/destination');
    await user.click(box('Select all scans in KCS-drought-2026'));
    await selectedCount('1 scan selected');

    await user.click(box('Select all scans in weep6-MBZ-Interaction-EXP1'));
    expect(
      screen.getByRole('button', { name: /Export 1 scan/ })
    ).toBeDisabled();

    answer({
      success: true,
      data: [
        { day: '2026-11-04', scan_count: 1 },
        { day: '2026-10-28', scan_count: 2 },
      ],
    });
    await selectedCount('4 scans selected');
    expect(screen.getByRole('button', { name: /Export 4 scan/ })).toBeEnabled();
  });

  it('shows why a row could not load, with Retry, and keeps the rest working', async () => {
    const user = userEvent.setup();
    api.experimentDays.mockResolvedValueOnce({
      success: false,
      error: 'database is locked',
    });
    render(<Export />);
    await screen.findByText('weep6-MBZ-Interaction-EXP1');

    await open(user, 'weep6-MBZ-Interaction-EXP1');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load its days: database is locked"
    );
    await open(user, 'KCS-drought-2026');
    expect(await screen.findByText('Oct 28, 2026')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Nov 4, 2026')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('searches experiments by any part of the name, ignoring case, and keeps hidden selections', async () => {
    const user = userEvent.setup();
    render(<Export />);
    await screen.findByText('weep6-MBZ-Interaction-EXP1');
    await user.click(box('Select all scans in KCS-drought-2026'));
    await selectedCount('1 scan selected');

    await user.type(screen.getByRole('searchbox'), 'mbz');
    const list = screen.getByRole('list');
    expect(
      within(list).getByText('weep6-MBZ-Interaction-EXP1')
    ).toBeInTheDocument();
    expect(
      within(list).queryByText('KCS-drought-2026')
    ).not.toBeInTheDocument();
    expect(screen.getByText('1 scan selected')).toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'nothing');
    expect(
      screen.getByText('No experiments match “nothing”.')
    ).toBeInTheDocument();
  });

  it('says when the experiments could not be loaded', async () => {
    api.experimentCounts.mockResolvedValue({
      success: false,
      error: 'disk I/O error',
    });
    render(<Export />);
    expect(await screen.findByText('disk I/O error')).toBeInTheDocument();
    expect(
      screen.getByText('Experiments could not be loaded')
    ).toBeInTheDocument();
  });
});
