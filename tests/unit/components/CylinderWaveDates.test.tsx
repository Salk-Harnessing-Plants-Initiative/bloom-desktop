/**
 * Unit tests for the Experiments page list of CylinderScan wave sowing dates and
 * their change log (#407). The list is read-only: dates change on Capture Scan.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CylinderWaveDates } from '../../../src/renderer/components/CylinderWaveDates';

const wave1 = {
  id: 'w1',
  wave_number: 1,
  sowing_date: '2025-11-25',
  note: null,
  set_by_name: 'Demo Phenotyper',
  set_at: '2026-01-02T09:00:00.000Z',
  scanCount: 72,
  changes: [
    {
      id: 'c1',
      old_sowing_date: '2025-11-26',
      new_sowing_date: '2025-11-27',
      reason: 'Typo',
      changed_by_name: 'Second Phenotyper',
      changed_at: '2025-12-01T10:00:00.000Z',
    },
    {
      id: 'c2',
      old_sowing_date: '2025-11-27',
      new_sowing_date: '2025-11-25',
      reason: 'Checked the seed log',
      changed_by_name: 'Demo Phenotyper',
      changed_at: '2025-12-02T10:00:00.000Z',
    },
  ],
};
const wave2 = {
  ...wave1,
  id: 'w2',
  wave_number: 2,
  sowing_date: '2026-02-20',
  scanCount: 1,
  changes: [],
};

describe('CylinderWaveDates', () => {
  let list: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    list = vi.fn().mockResolvedValue({ success: true, data: [wave1, wave2] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.window as any).electron.database.cylinderWaves.list = list;
  });

  it('lists each wave in a section that starts closed, with its date, who set it and scan count', async () => {
    render(<CylinderWaveDates experimentId="exp" />);
    const wave = await screen.findByTestId('wave-1');
    expect(wave).toHaveTextContent(
      /^Wave 1 .+ · 72 scansSet by Demo Phenotyper on .+/
    );
    expect(screen.getByTestId('wave-2')).toHaveTextContent(/· 1 scanSet by/);
    const section = screen.getByTestId('wave-dates-exp');
    expect(section.tagName).toBe('DETAILS');
    expect(section).not.toHaveAttribute('open');
    expect(section.querySelector('summary')).toHaveTextContent('2 waves');
    expect(list).toHaveBeenCalledWith('exp');
  });

  it('logs every change to the date, oldest first, with when, who and why', async () => {
    render(<CylinderWaveDates experimentId="exp" />);
    const log = await screen.findByTestId('wave-date-log-1');
    const entries = log.querySelectorAll('li');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent(
      /^Changed from .+ to .+ on .+ by Second Phenotyper\. Reason: Typo$/
    );
    expect(entries[1]).toHaveTextContent(
      /by Demo Phenotyper\. Reason: Checked the seed log$/
    );
    expect(screen.queryByTestId('wave-date-log-2')).not.toBeInTheDocument();
  });

  it("logs a wave's first date as Set to, and the backfill's as by admin", async () => {
    list.mockResolvedValue({
      success: true,
      data: [
        {
          ...wave2,
          changes: [
            {
              id: 'c9',
              old_sowing_date: null,
              new_sowing_date: '2026-02-20',
              reason: 'Set from earlier scans: 80 of 100 point to 20 Feb 2026',
              changed_by_name: 'admin',
              changed_at: '2026-10-27T10:00:00.000Z',
            },
          ],
        },
      ],
    });
    render(<CylinderWaveDates experimentId="exp" />);
    const entry = (await screen.findByTestId('wave-date-log-2')).querySelector(
      'li'
    );
    expect(entry).toHaveTextContent(
      /^Set to .+ on .+ by admin\. Reason: Set from earlier scans: 80 of 100 point to 20 Feb 2026$/
    );
  });

  it('says what each date is: on the wave, when set, when changed, and when only that changed', async () => {
    const basis = (b: string, other: string | null = null) => ({
      start_date_basis: b,
      start_date_basis_other: other,
    });
    list.mockResolvedValue({
      success: true,
      data: [
        {
          ...wave2,
          ...basis('sowing'),
          changes: [
            {
              id: 'c1',
              old_sowing_date: null,
              new_sowing_date: '2026-02-18',
              ...basis('other', 'two days after germination'),
              reason: null,
              changed_by_name: 'Demo Phenotyper',
              changed_at: '2026-02-21T10:00:00.000Z',
            },
            {
              id: 'c2',
              old_sowing_date: '2026-02-18',
              new_sowing_date: '2026-02-20',
              ...basis('transfer'),
              reason: null,
              changed_by_name: 'Demo Phenotyper',
              changed_at: '2026-02-22T10:00:00.000Z',
            },
            {
              id: 'c3',
              old_sowing_date: '2026-02-20',
              new_sowing_date: '2026-02-20',
              ...basis('sowing'),
              reason: 'Sown straight into the cylinder',
              changed_by_name: 'Demo Phenotyper',
              changed_at: '2026-02-23T10:00:00.000Z',
            },
          ],
        },
      ],
    });
    render(<CylinderWaveDates experimentId="exp" />);
    expect(await screen.findByTestId('wave-2')).toHaveTextContent(
      /^Wave 2 .+ · Sowing · 1 scan/
    );
    const entries = screen
      .getByTestId('wave-date-log-2')
      .querySelectorAll('li');
    expect(entries[0]).toHaveTextContent(
      /^Set to .+ \(other: two days after germination\) on /
    );
    expect(entries[1]).toHaveTextContent(
      /^Changed from .+ to .+ \(transfer to cylinder\) on /
    );
    expect(entries[2]).toHaveTextContent(
      /^.+ marked as sowing on .+ by Demo Phenotyper\. Reason: Sown straight into the cylinder$/
    );
  });

  it("shows a wave's note, and leaves it out when there is none", async () => {
    list.mockResolvedValue({
      success: true,
      data: [
        { ...wave1, note: 'Waves 2 to 4 were scanned on another PC' },
        wave2,
      ],
    });
    render(<CylinderWaveDates experimentId="exp" />);
    expect(await screen.findByTestId('wave-note-1')).toHaveTextContent(
      'Note: Waves 2 to 4 were scanned on another PC'
    );
    expect(screen.queryByTestId('wave-note-2')).not.toBeInTheDocument();
  });

  it('has no way to change a date here', async () => {
    render(<CylinderWaveDates experimentId="exp" />);
    await screen.findByTestId('wave-1');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the error when the waves cannot be loaded', async () => {
    list.mockResolvedValue({ success: false, error: 'database is locked' });
    render(<CylinderWaveDates experimentId="exp" />);
    expect(await screen.findByText('database is locked')).toBeInTheDocument();
  });

  it('shows the error when loading the waves throws', async () => {
    list.mockRejectedValue(new Error('IPC timed out'));
    render(<CylinderWaveDates experimentId="exp" />);
    expect(await screen.findByText('IPC timed out')).toBeInTheDocument();
  });

  it('shows nothing for an experiment without waves', async () => {
    list.mockResolvedValue({ success: true, data: [] });
    const { container } = render(<CylinderWaveDates experimentId="exp" />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
