/**
 * Unit tests for a plant's dates on Capture Scan (#428): using the wave's, having its
 * own, and a plant in a per-plant wave.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { PlantDatesSection } from '../../../src/renderer/components/PlantDatesSection';
import type {
  CylinderPlantInfo,
  CylinderWaveInfo,
} from '../../../src/types/cylinder-wave';

const wave: CylinderWaveInfo = {
  id: 'w2',
  wave_number: 2,
  dates_per_plant: false,
  germination_date: '2026-02-20',
  sowing_date: '2026-02-16',
  transfer_date: null,
  note: null,
  set_by_name: 'Demo Phenotyper',
  set_at: '2026-02-21T09:00:00.000Z',
  scanCount: 0,
  changes: [],
  plantsWithOwnDates: [],
};
const ownPlant: CylinderPlantInfo = {
  id: 'p1',
  wave_id: 'w2',
  plant_barcode: 'SB_017',
  germination_date: '2026-02-22',
  sowing_date: '2026-02-16',
  transfer_date: null,
  uses_wave_dates: false,
  reason: 'Germinated two days late',
  set_by_name: 'Demo Phenotyper',
  set_at: '2026-02-23T09:00:00.000Z',
  scanCount: 1,
  changes: [],
};
const waveDates = {
  germination_date: '2026-02-20',
  sowing_date: '2026-02-16',
  transfer_date: null,
};

function renderSection(
  props: Partial<Parameters<typeof PlantDatesSection>[0]> = {}
) {
  const onSave = vi.fn().mockResolvedValue({ success: true });
  const onUseWaveDates = vi.fn().mockResolvedValue({ success: true });
  const onOpenChange = vi.fn();
  render(
    <PlantDatesSection
      plantBarcode="SB_017"
      wave={wave}
      plant={null}
      plantDates={waveDates}
      onSave={onSave}
      onUseWaveDates={onUseWaveDates}
      phenotyperChosen
      onOpenChange={onOpenChange}
      {...props}
    />
  );
  return { onSave, onUseWaveDates, onOpenChange };
}

describe('PlantDatesSection', () => {
  it("says the plant uses the wave's dates, and offers different dates", () => {
    renderSection();
    expect(screen.getByTestId('plant-dates-source')).toHaveTextContent(
      "Plant SB_017 uses wave 2's dates · Different dates for this plant"
    );
    expect(screen.queryByTestId('plant-dates-box')).not.toBeInTheDocument();
  });

  it("sets the plant's own dates only with a reason, starting from the wave's", async () => {
    const { onSave, onOpenChange } = renderSection();
    fireEvent.click(screen.getByTestId('plant-dates-different'));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByLabelText('Germination date')).toHaveValue('2026-02-20');
    const save = screen.getByTestId('plant-dates-save');
    // The wave's own dates can't be saved as the plant's.
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Germination date'), {
      target: { value: '2026-02-22' },
    });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByTestId('plant-dates-reason'), {
      target: { value: 'Germinated two days late' },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        germinationDate: '2026-02-22',
        sowingDate: '2026-02-16',
        transferDate: undefined,
        reason: 'Germinated two days late',
      })
    );
  });

  it('shows a plant’s own dates and reason, with Edit and "Use the wave’s dates" before its first scan', async () => {
    const unscanned = { ...ownPlant, scanCount: 0 };
    const { onUseWaveDates } = renderSection({
      plant: unscanned,
      plantDates: unscanned,
    });
    expect(screen.getByTestId('plant-dates')).toHaveTextContent(
      /^Plant SB_017's own datesGermination date: .+Sown: .+Transferred: the same day as germinationReason: Germinated two days lateSet by Demo Phenotyper · Edit · Use the wave's dates$/
    );
    fireEvent.click(screen.getByTestId('plant-dates-use-wave'));
    await waitFor(() => expect(onUseWaveDates).toHaveBeenCalled());
  });

  it('asks for a plant’s dates in a per-plant wave, starting blank, with no reason or save button', () => {
    const onPendingDates = vi.fn();
    const { onSave, onOpenChange } = renderSection({
      wave: { ...wave, dates_per_plant: true, germination_date: null },
      plantDates: null,
      onPendingDates,
    });
    // Laid out like the rest of the form: no box, and the required dates marked.
    expect(screen.getByTestId('plant-dates-box')).not.toHaveClass('border-2');
    expect(screen.getByTestId('plant-dates-box')).toHaveTextContent(
      /^Sowing Date \*Germination Date \*/
    );
    expect(screen.queryByTestId('plant-dates-reason')).not.toBeInTheDocument();
    // Nothing is filled in: no plant's dates are carried over to another (#407).
    expect(screen.getByLabelText('Sowing date')).toHaveValue('');
    expect(screen.getByLabelText('Germination date')).toHaveValue('');
    // Until they're typed, nothing is handed over and Start Scan waits.
    expect(onPendingDates).toHaveBeenLastCalledWith(null);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    fireEvent.change(screen.getByLabelText('Sowing date'), {
      target: { value: '2026-02-16' },
    });
    fireEvent.change(screen.getByLabelText('Germination date'), {
      target: { value: '2026-02-22' },
    });
    // Nothing to press: the dates are saved when the scan starts, so they're handed
    // over once complete, and Start Scan isn't held for an open box.
    expect(screen.queryByTestId('plant-dates-save')).not.toBeInTheDocument();
    expect(onPendingDates).toHaveBeenLastCalledWith(
      expect.objectContaining({ germinationDate: '2026-02-22' })
    );
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onSave).not.toHaveBeenCalled();

    // Incomplete dates aren't handed over, and hold Start Scan.
    fireEvent.change(screen.getByLabelText('Germination date'), {
      target: { value: '' },
    });
    expect(onPendingDates).toHaveBeenLastCalledWith(null);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it('offers no way to change the dates of a plant with scans, in either kind of wave', () => {
    // A per-plant wave's plant, scanned once.
    renderSection({
      wave: { ...wave, dates_per_plant: true, germination_date: null },
      plant: ownPlant,
      plantDates: ownPlant,
    });
    expect(screen.getByTestId('plant-dates')).toHaveTextContent(
      /Set by Demo Phenotyper/
    );
    expect(screen.queryByTestId('plant-dates-edit')).not.toBeInTheDocument();
    // It says why, and where to go.
    expect(screen.getByTestId('plant-dates-locked')).toHaveTextContent(
      "Plant SB_017 already has scans, so its dates can't be changed. If they're wrong, contact the Bloom team."
    );
    cleanup();

    // A plant with its own dates in a same-dates wave, and one on the wave's dates.
    renderSection({
      plant: ownPlant,
      plantDates: ownPlant,
    });
    expect(screen.queryByTestId('plant-dates-edit')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('plant-dates-use-wave')
    ).not.toBeInTheDocument();
    cleanup();
    renderSection({
      plant: { ...ownPlant, uses_wave_dates: true },
    });
    expect(screen.getByTestId('plant-dates-source')).toHaveTextContent(
      /^Plant SB_017 uses wave 2's dates$/
    );
    expect(
      screen.queryByTestId('plant-dates-different')
    ).not.toBeInTheDocument();
  });

  it('shows the error when saving fails', async () => {
    const { onSave } = renderSection();
    onSave.mockResolvedValue({ success: false, error: 'database is locked' });
    fireEvent.click(screen.getByTestId('plant-dates-different'));
    fireEvent.change(screen.getByLabelText('Germination date'), {
      target: { value: '2026-02-22' },
    });
    fireEvent.change(screen.getByTestId('plant-dates-reason'), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByTestId('plant-dates-save'));
    expect(await screen.findByText('database is locked')).toBeInTheDocument();
  });
});
