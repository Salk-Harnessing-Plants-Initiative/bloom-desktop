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

  it('lists each wave with its current sowing date and scan count', async () => {
    render(<CylinderWaveDates experimentId="exp" />);
    expect(
      await screen.findByText(/Wave 1: sown .+ \(72 scans\)/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Wave 2: sown .+ \(1 scan\)/)).toBeInTheDocument();
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

  it('has no way to change a date here', async () => {
    render(<CylinderWaveDates experimentId="exp" />);
    await screen.findByText(/Wave 1: sown/);
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
