/**
 * Unit tests for the Experiments page list of CylinderScan wave sowing dates (#407).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CylinderWaveDates } from '../../../src/renderer/components/CylinderWaveDates';

const waves = [
  {
    id: 'w1',
    wave_number: 1,
    sowing_date: '2025-11-26',
    note: null,
    set_by_name: 'Demo Phenotyper',
    set_at: '2026-01-02T09:00:00.000Z',
    scanCount: 72,
  },
  {
    id: 'w2',
    wave_number: 2,
    sowing_date: '2026-02-20',
    note: null,
    set_by_name: 'Demo Phenotyper',
    set_at: '2026-01-02T09:00:00.000Z',
    scanCount: 0,
  },
];

describe('CylinderWaveDates', () => {
  let list: ReturnType<typeof vi.fn>;
  let changeSowingDate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    list = vi.fn().mockResolvedValue({ success: true, data: waves });
    changeSowingDate = vi
      .fn()
      .mockResolvedValue({ success: true, data: waves[1] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.window as any).electron.database.cylinderWaves = {
      list,
      create: vi.fn(),
      changeSowingDate,
    };
  });

  const openEditor = async (wave: number) => {
    render(<CylinderWaveDates experimentId="exp" />);
    await screen.findByText(/Wave 1: sown/);
    fireEvent.click(screen.getAllByText('Change date')[wave - 1]);
    return screen.getByTestId(`wave-date-editor-${wave}`);
  };

  it('lists the waves with their sowing dates and scan counts', async () => {
    render(<CylinderWaveDates experimentId="exp" />);
    expect(
      await screen.findByText(/Wave 1: sown .+ \(72 scans\)/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Wave 2: sown/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith('exp');
  });

  it('says "1 scan" for a single scan', async () => {
    list.mockResolvedValue({
      success: true,
      data: [{ ...waves[0], scanCount: 1 }],
    });
    render(<CylinderWaveDates experimentId="exp" />);
    expect(
      await screen.findByText(/Wave 1: sown .+ \(1 scan\)/)
    ).toBeInTheDocument();
  });

  it('changes a date freely before the wave has scans', async () => {
    const editor = await openEditor(2);
    fireEvent.change(screen.getByLabelText('New sowing date'), {
      target: { value: '2026-02-21' },
    });
    fireEvent.click(screen.getByText('Save date'));
    await waitFor(() =>
      expect(changeSowingDate).toHaveBeenCalledWith({
        waveId: 'w2',
        sowingDate: '2026-02-21',
        reason: undefined,
      })
    );
    expect(editor).not.toHaveTextContent('old sowing date');
  });

  it('needs a reason once the wave has scans, and says saved scans keep their age', async () => {
    const editor = await openEditor(1);
    expect(editor).toHaveTextContent(
      /72 scans in wave 1 were saved with ages from the old sowing date \(.+\)\. They are not changed: only new scans use the new date\./
    );
    fireEvent.change(screen.getByLabelText('New sowing date'), {
      target: { value: '2025-11-27' },
    });
    expect(screen.getByText('Save date')).toBeDisabled();
    expect(editor).toHaveTextContent('give a reason');
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Typo' },
    });
    fireEvent.click(screen.getByText('Save date'));
    await waitFor(() =>
      expect(changeSowingDate).toHaveBeenCalledWith({
        waveId: 'w1',
        sowingDate: '2025-11-27',
        reason: 'Typo',
      })
    );
  });

  it('shows the error when the change is refused', async () => {
    changeSowingDate.mockResolvedValue({
      success: false,
      error: 'Wave 1 was sown on 26 Nov 2025, so ...',
    });
    await openEditor(2);
    fireEvent.change(screen.getByLabelText('New sowing date'), {
      target: { value: '2025-11-01' },
    });
    fireEvent.click(screen.getByText('Save date'));
    expect(await screen.findByText(/^Wave 1 was sown on/)).toBeInTheDocument();
  });

  it('shows nothing for an experiment without waves', async () => {
    list.mockResolvedValue({ success: true, data: [] });
    const { container } = render(<CylinderWaveDates experimentId="exp" />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
