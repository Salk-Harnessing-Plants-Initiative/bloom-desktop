/**
 * Unit tests for the germination-date line under the wave number on Capture Scan (#407).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { WaveDatesInfo } from '../../../src/renderer/components/WaveDatesInfo';

const wave2 = {
  id: 'w2',
  wave_number: 2,
  germination_date: '2026-02-20',
  dates_per_plant: false,
  sowing_date: '2026-02-16',
  transfer_date: null,
  note: null,
  set_by_name: 'Demo Phenotyper',
  set_at: '2026-02-21T09:00:00.000Z',
  scanCount: 0,
  changes: [],
  plantsWithOwnDates: [],
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
      /^Germination date: .+Sown: .+Transferred: the same day as germinationDates updated by Demo Phenotyper on .+ · Edit$/
    );
  });

  it('shows a transfer date on another day', () => {
    renderInfo({ ...wave2, transfer_date: '2026-02-22' });
    expect(screen.getByTestId('wave-dates-info')).toHaveTextContent(
      /Transferred: .+2026Dates updated/
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
    expect(screen.getByTestId('wave-dates-info')).not.toHaveTextContent(
      'Sown:'
    );
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

  it('leaves out who updated the dates when the setter is unknown', () => {
    renderInfo({ ...wave2, set_by_name: null });
    expect(screen.getByTestId('wave-dates-info')).not.toHaveTextContent(
      'updated by'
    );
  });

  it("after scans, shows the wave's dates locked, with no way to save a change", () => {
    const onChangeDate = renderInfo({
      ...wave2,
      scanCount: 3,
      datedScanCount: 3,
    });
    fireEvent.click(screen.getByTestId('wave-dates-edit'));
    expect(
      screen.getByTestId('wave-dates-edit-scans-warning')
    ).toHaveTextContent(
      "Wave 2 already has scans, so its dates can't be changed. If they're wrong, contact the Bloom team."
    );
    expect(screen.getByLabelText('Germination date')).toBeDisabled();
    expect(screen.getByLabelText('Sowing date')).toBeDisabled();
    expect(
      screen.queryByTestId('wave-dates-edit-save')
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument();
    expect(screen.getByText('Close')).toBeInTheDocument();
    expect(onChangeDate).not.toHaveBeenCalled();
  });

  it('keeps the dates editable when the only scans are from before they were recorded', () => {
    renderInfo({ ...wave2, scanCount: 50, datedScanCount: 0 });
    fireEvent.click(screen.getByTestId('wave-dates-edit'));
    expect(screen.getByLabelText('Germination date')).not.toBeDisabled();
    expect(
      screen.queryByTestId('wave-dates-edit-scans-warning')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('wave-dates-edit-save')).toBeInTheDocument();
  });

  it('after scans, still lets the wave go per plant', async () => {
    const onUseDatesPerPlant = vi
      .fn()
      .mockResolvedValue({ success: true, data: null });
    render(
      <WaveDatesInfo
        wave={{ ...wave2, scanCount: 3, datedScanCount: 3 }}
        waves={[wave1, wave2]}
        onChangeDate={vi.fn()}
        onUseDatesPerPlant={onUseDatesPerPlant}
        phenotyperChosen
      />
    );
    fireEvent.click(screen.getByTestId('wave-dates-edit'));
    fireEvent.click(screen.getByTestId('dates-mode-per-plant'));
    const save = screen.getByTestId('wave-dates-edit-save');
    expect(save).toHaveTextContent('Set dates per plant');
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(onUseDatesPerPlant).toHaveBeenCalled());
  });

  it("sends a change to the wave's colour alone, cleaned, before the first scan", async () => {
    const onChangeDate = renderInfo();
    fireEvent.click(screen.getByTestId('wave-dates-edit'));
    // Typed and saved without leaving the field.
    fireEvent.change(screen.getByLabelText('Germination colour'), {
      target: { value: 'germ red' },
    });
    const save = screen.getByTestId('wave-dates-edit-save');
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(onChangeDate).toHaveBeenCalledWith(
        expect.objectContaining({ germDayColor: 'GermRed' })
      )
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

  describe("Edit: how the wave's dates are set", () => {
    const perPlant = {
      ...wave2,
      dates_per_plant: true,
      germination_date: null,
      sowing_date: null,
    };
    const plants = [
      {
        id: 'p1',
        wave_id: 'w2',
        plant_barcode: 'SB_001',
        germination_date: '2026-02-20',
        sowing_date: '2026-02-16',
        transfer_date: null,
        uses_wave_dates: false,
        reason: null,
        set_by_name: 'Demo Phenotyper',
        set_at: '2026-02-21T09:00:00.000Z',
        scanCount: 1,
        changes: [],
      },
    ];
    function renderEdit(
      wave: Record<string, unknown>,
      props: Record<string, unknown> = {}
    ) {
      const handlers = {
        onChangeDate: vi.fn().mockResolvedValue({ success: true }),
        onUseSameDates: vi.fn().mockResolvedValue({ success: true }),
        onUseDatesPerPlant: vi.fn().mockResolvedValue({ success: true }),
        onOpenChange: vi.fn(),
      };
      render(
        <WaveDatesInfo
          wave={{ ...wave2, ...wave } as typeof wave2}
          waves={[wave1]}
          phenotyperChosen
          plants={[]}
          canUseSameDates
          sharedPlantDates={null}
          {...handlers}
          {...props}
        />
      );
      fireEvent.click(screen.getByTestId('wave-dates-edit'));
      return handlers;
    }

    it('shows a per-plant wave with how many plants are set, and Edit', () => {
      render(
        <WaveDatesInfo
          wave={perPlant}
          waves={[wave1]}
          onChangeDate={vi.fn()}
          phenotyperChosen
          plants={plants}
        />
      );
      expect(screen.getByTestId('wave-dates-info')).toHaveTextContent(
        /^Wave 2's dates are set for each plant1 plant set so farSet up by Demo Phenotyper on .+ · Edit$/
      );
    });

    it("opens on the current answer, with the plants' dates set so far", () => {
      renderEdit(perPlant, { plants });
      expect(screen.getByTestId('dates-mode-per-plant')).toBeChecked();
      expect(screen.getByTestId('plants-dates-list')).toHaveTextContent(
        'SB_001: germinated Feb 20, 2026 · sown Feb 16, 2026 · transferred the same day'
      );
    });

    it("switches a per-plant wave to the same dates for all plants, filled in with the plants' shared dates", async () => {
      const { onUseSameDates, onOpenChange } = renderEdit(perPlant, {
        plants,
        sharedPlantDates: plants[0],
      });
      expect(onOpenChange).toHaveBeenLastCalledWith(true);
      fireEvent.click(screen.getByTestId('dates-mode-same'));
      expect(screen.getByLabelText('Germination date')).toHaveValue(
        '2026-02-20'
      );
      fireEvent.click(screen.getByTestId('wave-dates-edit-save'));
      await waitFor(() =>
        expect(onUseSameDates).toHaveBeenCalledWith({
          germinationDate: '2026-02-20',
          sowingDate: '2026-02-16',
          transferDate: undefined,
          reason: undefined,
        })
      );
    });

    it("after scans, locks the shared dates; and can't go back when plants differ", () => {
      renderEdit(
        { ...perPlant, scanCount: 3, datedScanCount: 3 },
        { plants, sharedPlantDates: plants[0] }
      );
      fireEvent.click(screen.getByTestId('dates-mode-same'));
      expect(screen.getByTestId('same-dates-locked')).toBeInTheDocument();
      expect(screen.getByLabelText('Germination date')).toBeDisabled();
      cleanup();
      renderEdit(
        { ...perPlant, scanCount: 3, datedScanCount: 3 },
        { canUseSameDates: false }
      );
      expect(screen.getByTestId('dates-mode-same')).toBeDisabled();
      expect(screen.getByTestId('dates-mode-question')).toHaveTextContent(
        "This wave's plants were scanned with different dates."
      );
    });

    it('switches a wave with the same dates to per plant, saying scanned plants keep theirs', async () => {
      const { onUseDatesPerPlant } = renderEdit({});
      expect(screen.getByTestId('dates-mode-same')).toBeChecked();
      fireEvent.click(screen.getByTestId('dates-mode-per-plant'));
      expect(screen.getByTestId('dates-per-plant')).toHaveTextContent(
        'Plants already scanned keep the dates they were scanned with.'
      );
      fireEvent.click(screen.getByTestId('wave-dates-edit-save'));
      await waitFor(() => expect(onUseDatesPerPlant).toHaveBeenCalled());
    });
  });

  it('greys out everything inside an open Edit box while scanning', () => {
    const onChangeDate = vi.fn();
    const { rerender } = render(
      <WaveDatesInfo
        wave={{ ...wave2 }}
        waves={[wave1, wave2]}
        onChangeDate={onChangeDate}
        phenotyperChosen
      />
    );
    fireEvent.click(screen.getByTestId('wave-dates-edit'));
    rerender(
      <WaveDatesInfo
        wave={{ ...wave2 }}
        waves={[wave1, wave2]}
        onChangeDate={onChangeDate}
        phenotyperChosen
        disabled
      />
    );
    expect(screen.getByLabelText('Germination date')).toBeDisabled();
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
      /^Germination date: .+Transferred: the same day as germinationDates updated on .+ · Edit$/
    );
  });
});
