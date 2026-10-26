/**
 * Unit tests for the germination-date line under the wave number on Capture Scan (#407).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WaveDatesInfo } from '../../../src/renderer/components/WaveDatesInfo';

const wave2 = {
  id: 'w2',
  wave_number: 2,
  germination_date: '2026-02-20',
  sowing_date: '2026-02-16',
  transfer_date: null,
  note: null,
  set_by_name: 'Demo Phenotyper',
  set_at: '2026-02-21T09:00:00.000Z',
  scanCount: 0,
  changes: [],
};
const wave1 = { wave_number: 1, germination_date: '2025-11-26' };

function renderInfo(wave = wave2) {
  const onChangeDate = vi.fn().mockResolvedValue({ success: true });
  render(
    <WaveDatesInfo
      wave={wave}
      waves={[wave1, wave]}
      onChangeDate={onChangeDate}
      phenotyperChosen
    />
  );
  return onChangeDate;
}

describe('WaveDatesInfo', () => {
  it('shows the germination date, who set it and when', () => {
    renderInfo();
    expect(screen.getByTestId('wave-dates-info')).toHaveTextContent(
      /^Germination date: .+ · sown .+ · transferred the same day · set by Demo Phenotyper on .+Edit$/
    );
  });

  it('shows a transfer date on another day', () => {
    renderInfo({ ...wave2, transfer_date: '2026-02-22' });
    expect(screen.getByTestId('wave-dates-info')).toHaveTextContent(
      /· transferred .+2026 ·/
    );
  });

  it('changes only the sowing date, keeping the germination date', async () => {
    const onChangeDate = renderInfo();
    fireEvent.click(screen.getByTestId('wave-dates-edit'));
    // It opens with the saved dates; keeping all three can't be saved.
    expect(screen.getByLabelText('Sowing date')).toHaveValue('2026-02-16');
    expect(screen.getByTestId('transfer-same-day')).toBeChecked();
    expect(screen.getByTestId('wave-dates-edit-save')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Sowing date'), {
      target: { value: '2026-02-15' },
    });
    fireEvent.click(screen.getByTestId('wave-dates-edit-save'));
    await waitFor(() =>
      expect(onChangeDate).toHaveBeenCalledWith({
        germinationDate: '2026-02-20',
        sowingDate: '2026-02-15',
        transferDate: undefined,
        reason: undefined,
      })
    );
  });

  it('asks for a sowing date on a backfilled wave that has none', () => {
    renderInfo({ ...wave2, sowing_date: null });
    expect(screen.getByTestId('wave-dates-info')).not.toHaveTextContent('sown');
    fireEvent.click(screen.getByTestId('wave-dates-edit'));
    fireEvent.change(screen.getByLabelText('Germination date'), {
      target: { value: '2026-02-19' },
    });
    expect(screen.getByTestId('wave-dates-edit-save')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Sowing date'), {
      target: { value: '2026-02-16' },
    });
    expect(screen.getByTestId('wave-dates-edit-save')).not.toBeDisabled();
  });

  it('leaves out "set by" when the setter is unknown', () => {
    renderInfo({ ...wave2, set_by_name: null });
    expect(screen.getByTestId('wave-dates-info')).not.toHaveTextContent(
      'set by'
    );
  });

  it('after scans, still offers Edit but needs a reason and warns the scans keep their age', async () => {
    const onChangeDate = renderInfo({ ...wave2, scanCount: 3 });
    fireEvent.click(screen.getByTestId('wave-dates-edit'));
    expect(
      screen.getByTestId('wave-dates-edit-scans-warning')
    ).toHaveTextContent(
      '3 scans in wave 2 are already saved. They keep the ages they were saved with: only new scans use the new date.'
    );
    fireEvent.change(screen.getByLabelText('Germination date'), {
      target: { value: '2026-02-19' },
    });
    const save = screen.getByTestId('wave-dates-edit-save');
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Typo: sown a day earlier' },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(onChangeDate).toHaveBeenCalledWith({
        germinationDate: '2026-02-19',
        sowingDate: '2026-02-16',
        transferDate: undefined,
        reason: 'Typo: sown a day earlier',
      })
    );
  });

  it('before scans, needs no reason and shows no warning', () => {
    renderInfo();
    fireEvent.click(screen.getByTestId('wave-dates-edit'));
    expect(
      screen.queryByTestId('wave-dates-edit-scans-warning')
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument();
  });

  it('saves an edited date', async () => {
    const onChangeDate = renderInfo();
    fireEvent.click(screen.getByTestId('wave-dates-edit'));
    const save = screen.getByTestId('wave-dates-edit-save');
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Germination date'), {
      target: { value: '2026-02-19' },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(onChangeDate).toHaveBeenCalledWith({
        germinationDate: '2026-02-19',
        sowingDate: '2026-02-16',
        transferDate: undefined,
        reason: undefined,
      })
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId('wave-dates-edit-box')
      ).not.toBeInTheDocument()
    );
  });

  it('needs a note when the edited date is on or before an earlier wave', async () => {
    const onChangeDate = renderInfo();
    fireEvent.click(screen.getByTestId('wave-dates-edit'));
    fireEvent.change(screen.getByLabelText('Germination date'), {
      target: { value: '2025-11-26' },
    });
    fireEvent.change(screen.getByLabelText('Sowing date'), {
      target: { value: '2025-11-22' },
    });
    const save = screen.getByTestId('wave-dates-edit-save');
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Sown together' },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(onChangeDate).toHaveBeenCalledWith({
        germinationDate: '2025-11-26',
        sowingDate: '2025-11-22',
        transferDate: undefined,
        reason: 'Sown together',
      })
    );
  });

  it('shows the error when the change is refused', async () => {
    const onChange = vi
      .fn()
      .mockResolvedValue({ success: false, error: 'database is locked' });
    render(
      <WaveDatesInfo
        wave={wave2}
        waves={[wave1, wave2]}
        onChangeDate={onChange}
        phenotyperChosen
      />
    );
    fireEvent.click(screen.getByTestId('wave-dates-edit'));
    fireEvent.change(screen.getByLabelText('Germination date'), {
      target: { value: '2026-02-19' },
    });
    fireEvent.click(screen.getByTestId('wave-dates-edit-save'));
    expect(await screen.findByText('database is locked')).toBeInTheDocument();
  });

  it('shows the error when saving the change throws', async () => {
    const onChange = vi.fn().mockRejectedValue(new Error('IPC timed out'));
    render(
      <WaveDatesInfo
        wave={wave2}
        waves={[wave1, wave2]}
        onChangeDate={onChange}
        phenotyperChosen
      />
    );
    fireEvent.click(screen.getByTestId('wave-dates-edit'));
    fireEvent.change(screen.getByLabelText('Germination date'), {
      target: { value: '2026-02-19' },
    });
    fireEvent.click(screen.getByTestId('wave-dates-edit-save'));
    expect(await screen.findByText('IPC timed out')).toBeInTheDocument();
    // The box stays open so the operator can try again or cancel.
    expect(screen.getByTestId('wave-dates-edit-save')).toBeInTheDocument();
  });

  it('offers no Edit while the age is changed for this scan, and says why', () => {
    render(
      <WaveDatesInfo
        wave={wave2}
        waves={[wave1, wave2]}
        onChangeDate={vi.fn()}
        phenotyperChosen
        lockedMessage="The age was changed for this scan."
      />
    );
    expect(screen.queryByTestId('wave-dates-edit')).not.toBeInTheDocument();
    expect(screen.getByTestId('wave-dates-edit-locked')).toHaveTextContent(
      'The age was changed for this scan.'
    );
  });

  it('greys out everything inside an open Edit box while scanning', () => {
    const onChangeDate = vi.fn();
    const { rerender } = render(
      <WaveDatesInfo
        wave={{ ...wave2, scanCount: 1 }}
        waves={[wave1, wave2]}
        onChangeDate={onChangeDate}
        phenotyperChosen
      />
    );
    fireEvent.click(screen.getByTestId('wave-dates-edit'));
    rerender(
      <WaveDatesInfo
        wave={{ ...wave2, scanCount: 1 }}
        waves={[wave1, wave2]}
        onChangeDate={onChangeDate}
        phenotyperChosen
        disabled
      />
    );
    expect(screen.getByLabelText('Germination date')).toBeDisabled();
    expect(screen.getByLabelText('Reason')).toBeDisabled();
    expect(screen.getByTestId('wave-dates-edit-save')).toBeDisabled();
    expect(screen.getByText('Cancel')).toBeDisabled();
  });

  it('reports when the Edit box opens and closes', () => {
    const onOpenChange = vi.fn();
    render(
      <WaveDatesInfo
        wave={wave2}
        waves={[wave1, wave2]}
        onChangeDate={vi.fn()}
        phenotyperChosen
        onOpenChange={onOpenChange}
      />
    );
    fireEvent.click(screen.getByTestId('wave-dates-edit'));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('needs a phenotyper before a date change can be saved', () => {
    render(
      <WaveDatesInfo
        wave={wave2}
        waves={[wave1, wave2]}
        onChangeDate={vi.fn()}
        phenotyperChosen={false}
      />
    );
    fireEvent.click(screen.getByTestId('wave-dates-edit'));
    fireEvent.change(screen.getByLabelText('Germination date'), {
      target: { value: '2026-02-19' },
    });
    expect(screen.getByTestId('wave-dates-needs-phenotyper')).toHaveTextContent(
      'Choose the phenotyper first.'
    );
    expect(screen.getByTestId('wave-dates-edit-save')).toBeDisabled();
  });

  it('says only when the date was set when the setter is unknown', () => {
    render(
      <WaveDatesInfo
        wave={{ ...wave2, set_by_name: null }}
        waves={[wave1, wave2]}
        onChangeDate={vi.fn()}
        phenotyperChosen
      />
    );
    expect(screen.getByTestId('wave-dates-info')).toHaveTextContent(
      /^Germination date: .+ · transferred the same day \(set on .+\) Edit$/
    );
  });
});
