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
  start_date_basis: 'transfer',
  start_date_basis_other: null,
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
      phenotyperChosen
    />
  );
  return onChangeDate;
}

describe('WaveSowingDateInfo', () => {
  it('shows the sowing date, who set it and when', () => {
    renderInfo();
    expect(screen.getByTestId('wave-sowing-date-info')).toHaveTextContent(
      /^Start date to compute age: .+ · set by Demo Phenotyper on .+Edit$/
    );
  });

  it('says what the start date is', () => {
    renderInfo({
      ...wave2,
      start_date_basis: 'other',
      start_date_basis_other: 'two days after germination',
    });
    expect(screen.getByTestId('wave-sowing-date-info')).toHaveTextContent(
      '(other: two days after germination)'
    );
  });

  it('changes only what the date is, keeping the date', async () => {
    const onChangeDate = renderInfo();
    fireEvent.click(screen.getByTestId('sowing-date-edit'));
    // It opens with the saved choice; keeping both the date and it can't be saved.
    expect(screen.getByTestId('start-date-basis-transfer')).toBeChecked();
    expect(screen.getByTestId('sowing-date-edit-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('start-date-basis-sowing'));
    fireEvent.click(screen.getByTestId('sowing-date-edit-save'));
    await waitFor(() =>
      expect(onChangeDate).toHaveBeenCalledWith({
        sowingDate: '2026-02-20',
        startDateBasis: 'sowing',
        startDateBasisOther: undefined,
        reason: undefined,
      })
    );
  });

  it('asks for what the date is on a backfilled wave that has none', () => {
    renderInfo({ ...wave2, start_date_basis: null });
    expect(screen.getByTestId('wave-sowing-date-info')).not.toHaveTextContent(
      '('
    );
    fireEvent.click(screen.getByTestId('sowing-date-edit'));
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2026-02-19' },
    });
    expect(screen.getByTestId('sowing-date-edit-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('start-date-basis-germination'));
    expect(screen.getByTestId('sowing-date-edit-save')).not.toBeDisabled();
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
      '3 scans in wave 2 are already saved. They keep the ages they were saved with: only new scans use the new date.'
    );
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2026-02-19' },
    });
    const save = screen.getByTestId('sowing-date-edit-save');
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Typo: sown a day earlier' },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(onChangeDate).toHaveBeenCalledWith({
        sowingDate: '2026-02-19',
        startDateBasis: 'transfer',
        startDateBasisOther: undefined,
        reason: 'Typo: sown a day earlier',
      })
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
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2026-02-19' },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(onChangeDate).toHaveBeenCalledWith({
        sowingDate: '2026-02-19',
        startDateBasis: 'transfer',
        startDateBasisOther: undefined,
        reason: undefined,
      })
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
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2025-11-26' },
    });
    const save = screen.getByTestId('sowing-date-edit-save');
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Sown together' },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(onChangeDate).toHaveBeenCalledWith({
        sowingDate: '2025-11-26',
        startDateBasis: 'transfer',
        startDateBasisOther: undefined,
        reason: 'Sown together',
      })
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
        phenotyperChosen
      />
    );
    fireEvent.click(screen.getByTestId('sowing-date-edit'));
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2026-02-19' },
    });
    fireEvent.click(screen.getByTestId('sowing-date-edit-save'));
    expect(await screen.findByText('database is locked')).toBeInTheDocument();
  });

  it('shows the error when saving the change throws', async () => {
    const onChange = vi.fn().mockRejectedValue(new Error('IPC timed out'));
    render(
      <WaveSowingDateInfo
        wave={wave2}
        waves={[wave1, wave2]}
        onChangeDate={onChange}
        phenotyperChosen
      />
    );
    fireEvent.click(screen.getByTestId('sowing-date-edit'));
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2026-02-19' },
    });
    fireEvent.click(screen.getByTestId('sowing-date-edit-save'));
    expect(await screen.findByText('IPC timed out')).toBeInTheDocument();
    // The box stays open so the operator can try again or cancel.
    expect(screen.getByTestId('sowing-date-edit-save')).toBeInTheDocument();
  });

  it('offers no Edit while the age is changed for this scan, and says why', () => {
    render(
      <WaveSowingDateInfo
        wave={wave2}
        waves={[wave1, wave2]}
        onChangeDate={vi.fn()}
        phenotyperChosen
        lockedMessage="The age was changed for this scan."
      />
    );
    expect(screen.queryByTestId('sowing-date-edit')).not.toBeInTheDocument();
    expect(screen.getByTestId('sowing-date-edit-locked')).toHaveTextContent(
      'The age was changed for this scan.'
    );
  });

  it('greys out everything inside an open Edit box while scanning', () => {
    const onChangeDate = vi.fn();
    const { rerender } = render(
      <WaveSowingDateInfo
        wave={{ ...wave2, scanCount: 1 }}
        waves={[wave1, wave2]}
        onChangeDate={onChangeDate}
        phenotyperChosen
      />
    );
    fireEvent.click(screen.getByTestId('sowing-date-edit'));
    rerender(
      <WaveSowingDateInfo
        wave={{ ...wave2, scanCount: 1 }}
        waves={[wave1, wave2]}
        onChangeDate={onChangeDate}
        phenotyperChosen
        disabled
      />
    );
    expect(screen.getByLabelText('Start date')).toBeDisabled();
    expect(screen.getByLabelText('Reason')).toBeDisabled();
    expect(screen.getByTestId('sowing-date-edit-save')).toBeDisabled();
    expect(screen.getByText('Cancel')).toBeDisabled();
  });

  it('reports when the Edit box opens and closes', () => {
    const onOpenChange = vi.fn();
    render(
      <WaveSowingDateInfo
        wave={wave2}
        waves={[wave1, wave2]}
        onChangeDate={vi.fn()}
        phenotyperChosen
        onOpenChange={onOpenChange}
      />
    );
    fireEvent.click(screen.getByTestId('sowing-date-edit'));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('needs a phenotyper before a date change can be saved', () => {
    render(
      <WaveSowingDateInfo
        wave={wave2}
        waves={[wave1, wave2]}
        onChangeDate={vi.fn()}
        phenotyperChosen={false}
      />
    );
    fireEvent.click(screen.getByTestId('sowing-date-edit'));
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2026-02-19' },
    });
    expect(
      screen.getByTestId('sowing-date-needs-phenotyper')
    ).toHaveTextContent('Choose the phenotyper first.');
    expect(screen.getByTestId('sowing-date-edit-save')).toBeDisabled();
  });

  it('says only when the date was set when the setter is unknown', () => {
    render(
      <WaveSowingDateInfo
        wave={{ ...wave2, set_by_name: null }}
        waves={[wave1, wave2]}
        onChangeDate={vi.fn()}
        phenotyperChosen
      />
    );
    expect(screen.getByTestId('wave-sowing-date-info')).toHaveTextContent(
      /^Start date to compute age: .+ \(set on .+\) Edit$/
    );
  });
});
