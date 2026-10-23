/**
 * Unit tests for the sowing-date line under the wave number on Capture Scan (#407).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WaveSowingDateInfo } from '../../../src/renderer/components/WaveSowingDateInfo';

const wave2 = {
  id: 'w2',
  wave_number: 2,
  sowing_date: '2026-02-20',
  note: null,
  set_by_name: 'Demo Phenotyper',
  set_at: '2026-02-21T09:00:00.000Z',
  scanCount: 0,
  changes: [],
};
const wave1 = { wave_number: 1, sowing_date: '2025-11-26' };

function renderInfo(wave = wave2) {
  const onChangeDate = vi.fn().mockResolvedValue({ success: true });
  render(
    <WaveSowingDateInfo
      wave={wave}
      waves={[wave1, wave]}
      onChangeDate={onChangeDate}
    />
  );
  return onChangeDate;
}

describe('WaveSowingDateInfo', () => {
  it('shows the sowing date, who set it and when', () => {
    renderInfo();
    expect(screen.getByTestId('wave-sowing-date-info')).toHaveTextContent(
      /^Sowing date: .+ · set by Demo Phenotyper on .+Edit$/
    );
  });

  it('leaves out "set by" when the setter is unknown', () => {
    renderInfo({ ...wave2, set_by_name: null });
    expect(screen.getByTestId('wave-sowing-date-info')).not.toHaveTextContent(
      'set by'
    );
  });

  it('after scans, still offers Edit but needs a reason and warns the scans keep their age', async () => {
    const onChangeDate = renderInfo({ ...wave2, scanCount: 3 });
    fireEvent.click(screen.getByTestId('sowing-date-edit'));
    expect(
      screen.getByTestId('sowing-date-edit-scans-warning')
    ).toHaveTextContent(
      '3 scans in wave 2 were saved with ages from this date. They are not changed: only new scans use the new date.'
    );
    fireEvent.change(screen.getByLabelText('Sowing date'), {
      target: { value: '2026-02-19' },
    });
    const save = screen.getByTestId('sowing-date-edit-save');
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Typo: sown a day earlier' },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(onChangeDate).toHaveBeenCalledWith(
        '2026-02-19',
        'Typo: sown a day earlier'
      )
    );
  });

  it('before scans, needs no reason and shows no warning', () => {
    renderInfo();
    fireEvent.click(screen.getByTestId('sowing-date-edit'));
    expect(
      screen.queryByTestId('sowing-date-edit-scans-warning')
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument();
  });

  it('saves an edited date', async () => {
    const onChangeDate = renderInfo();
    fireEvent.click(screen.getByTestId('sowing-date-edit'));
    const save = screen.getByTestId('sowing-date-edit-save');
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Sowing date'), {
      target: { value: '2026-02-19' },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(onChangeDate).toHaveBeenCalledWith('2026-02-19', undefined)
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId('sowing-date-edit-box')
      ).not.toBeInTheDocument()
    );
  });

  it('needs a note when the edited date is on or before an earlier wave', async () => {
    const onChangeDate = renderInfo();
    fireEvent.click(screen.getByTestId('sowing-date-edit'));
    fireEvent.change(screen.getByLabelText('Sowing date'), {
      target: { value: '2025-11-26' },
    });
    const save = screen.getByTestId('sowing-date-edit-save');
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Sown together' },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(onChangeDate).toHaveBeenCalledWith('2025-11-26', 'Sown together')
    );
  });

  it('shows the error when the change is refused', async () => {
    const onChange = vi
      .fn()
      .mockResolvedValue({ success: false, error: 'database is locked' });
    render(
      <WaveSowingDateInfo
        wave={wave2}
        waves={[wave1, wave2]}
        onChangeDate={onChange}
      />
    );
    fireEvent.click(screen.getByTestId('sowing-date-edit'));
    fireEvent.change(screen.getByLabelText('Sowing date'), {
      target: { value: '2026-02-19' },
    });
    fireEvent.click(screen.getByTestId('sowing-date-edit-save'));
    expect(await screen.findByText('database is locked')).toBeInTheDocument();
  });
});
