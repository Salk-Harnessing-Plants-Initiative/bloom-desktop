/**
 * Unit tests for the Capture Scan sowing-date panel and the plant-age note (#407).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WaveSowingDatePanel } from '../../../src/renderer/components/WaveSowingDatePanel';
import { PlantAgeNote } from '../../../src/renderer/components/PlantAgeNote';
import { toIsoDate } from '../../../src/utils/sowing-date';

/** Local "YYYY-MM-DD" `n` days ago, by calendar arithmetic so DST can't shift it. */
const daysAgo = (n: number) => {
  const now = new Date();
  return toIsoDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - n)
  );
};
const wave1 = { wave_number: 1, sowing_date: daysAgo(90) };

function renderPanel(waveNumber = 2, waves = [wave1]) {
  const onSave = vi.fn().mockResolvedValue({ success: true });
  render(
    <WaveSowingDatePanel
      waveNumber={waveNumber}
      waves={waves}
      phenotyperId="ph-1"
      onSave={onSave}
    />
  );
  const setDate = (value: string) =>
    fireEvent.change(screen.getByTestId('sowing-date-input'), {
      target: { value },
    });
  return {
    onSave,
    setDate,
    save: () => screen.getByTestId('sowing-date-save'),
  };
}

describe('WaveSowingDatePanel', () => {
  it('saves a sowing date after the earlier wave, with who set it', async () => {
    const { onSave, setDate, save } = renderPanel();
    expect(save()).toBeDisabled();
    setDate(daysAgo(9));
    fireEvent.click(save());
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        sowingDate: daysAgo(9),
        note: undefined,
        waveConfirmed: false,
        phenotyperId: 'ph-1',
      })
    );
  });

  it('needs a phenotyper before the date can be saved', () => {
    const onSave = vi.fn();
    render(
      <WaveSowingDatePanel
        waveNumber={2}
        waves={[wave1]}
        phenotyperId=""
        onSave={onSave}
      />
    );
    fireEvent.change(screen.getByTestId('sowing-date-input'), {
      target: { value: daysAgo(9) },
    });
    expect(
      screen.getByTestId('sowing-date-needs-phenotyper')
    ).toHaveTextContent('Choose the phenotyper first.');
    expect(screen.getByTestId('sowing-date-save')).toBeDisabled();
  });

  it('shows what earlier scans point to, and fills that date on request', () => {
    const earlier = {
      scanCount: 100,
      agreeing: 80,
      candidates: [
        { date: daysAgo(14), count: 80 },
        { date: daysAgo(11), count: 20 },
      ],
      scannedWaveNumbers: [1],
    };
    render(
      <WaveSowingDatePanel
        waveNumber={1}
        waves={[]}
        phenotyperId="ph-1"
        earlier={earlier}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByTestId('sowing-date-earlier-scans')).toHaveTextContent(
      /^Earlier scans in wave 1 \(100\) point to sowing on .+ \(80 scans\) or .+ \(20 scans\)\./
    );
    fireEvent.click(screen.getByTestId('sowing-date-use-earlier'));
    expect(screen.getByTestId('sowing-date-input')).toHaveValue(daysAgo(14));
    expect(screen.queryByTestId('sowing-date-note')).not.toBeInTheDocument();
    expect(screen.getByTestId('sowing-date-save')).not.toBeDisabled();

    // A date far from it needs a note.
    fireEvent.change(screen.getByTestId('sowing-date-input'), {
      target: { value: daysAgo(4) },
    });
    expect(
      screen.getByText(/Add a note saying why this date is different\.$/)
    ).toBeInTheDocument();
    expect(screen.getByTestId('sowing-date-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('sowing-date-note'), {
      target: { value: 'Checked the seed log' },
    });
    expect(screen.getByTestId('sowing-date-save')).not.toBeDisabled();
  });

  it('refuses a future date', () => {
    const { setDate, save } = renderPanel();
    setDate(daysAgo(-2));
    expect(
      screen.getByText("The sowing date can't be in the future.")
    ).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('needs a note for a date on or before wave 1', async () => {
    const { onSave, setDate, save } = renderPanel();
    setDate(daysAgo(90));
    expect(
      screen.getByText(/^Wave 1 was sown on .+ Add a note saying why\.$/)
    ).toBeInTheDocument();
    expect(save()).toBeDisabled();
    fireEvent.change(screen.getByTestId('sowing-date-note'), {
      target: { value: 'Both waves sown together' },
    });
    fireEvent.click(save());
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ note: 'Both waves sown together' })
      )
    );
  });

  it('needs a tick for a wave number that skips ahead', () => {
    const { setDate, save } = renderPanel(5);
    setDate(daysAgo(9));
    expect(save()).toBeDisabled();
    fireEvent.click(screen.getByTestId('sowing-date-wave-confirm'));
    expect(save()).not.toBeDisabled();
  });

  it('shows the error when saving fails', async () => {
    const { onSave, setDate, save } = renderPanel();
    onSave.mockResolvedValue({ success: false, error: 'database is locked' });
    setDate(daysAgo(9));
    fireEvent.click(save());
    expect(await screen.findByText('database is locked')).toBeInTheDocument();
  });
});

describe('PlantAgeNote', () => {
  const wave = {
    id: 'w1',
    wave_number: 1,
    sowing_date: daysAgo(9),
    note: null,
    set_by_name: 'Demo Phenotyper',
    set_at: '2026-01-02T09:00:00.000Z',
    scanCount: 0,
    changes: [],
  };

  it('says where the age came from', () => {
    render(
      <PlantAgeNote
        wave={wave}
        calculatedAge={9}
        change={null}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByTestId('plant-age-note')).toHaveTextContent(
      /Calculated from wave 1's sowing date/
    );
  });

  it('changes the age only with a different age and a reason', () => {
    const onChange = vi.fn();
    render(
      <PlantAgeNote
        wave={wave}
        calculatedAge={9}
        change={null}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByTestId('change-age'));
    const confirm = screen.getByTestId('change-age-confirm');
    fireEvent.change(screen.getByTestId('change-age-input'), {
      target: { value: '9' },
    });
    expect(screen.getByText('That is the calculated age.')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('change-age-input'), {
      target: { value: '8' },
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId('change-age-reason'), {
      target: { value: ' Experiment was sown later ' },
    });
    fireEvent.click(confirm);
    expect(onChange).toHaveBeenCalledWith({
      age: 8,
      reason: 'Experiment was sown later',
    });
  });

  it('shows who changed the age, the calculated age and the reason, and can go back', () => {
    const onChange = vi.fn();
    render(
      <PlantAgeNote
        wave={wave}
        calculatedAge={9}
        change={{ age: 8, reason: 'Experiment was sown later' }}
        onChange={onChange}
        phenotyperName="Demo Phenotyper"
      />
    );
    const changed = screen.getByTestId('plant-age-changed');
    expect(changed).toHaveTextContent(
      'Demo Phenotyper has manually updated the plant age.'
    );
    expect(changed).toHaveTextContent(
      'Calculated age: 9 days. Reason: Experiment was sown later'
    );
    fireEvent.click(screen.getByText('Use calculated age'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('says "The phenotyper" when the name is not known yet', () => {
    render(
      <PlantAgeNote
        wave={wave}
        calculatedAge={9}
        change={{ age: 8, reason: 'Experiment was sown later' }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByTestId('plant-age-changed')).toHaveTextContent(
      'The phenotyper has manually updated the plant age.'
    );
  });

  it('says the calculated age and that the change is for this scan only', () => {
    render(
      <PlantAgeNote
        wave={wave}
        calculatedAge={9}
        change={null}
        onChange={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('change-age'));
    expect(screen.getByText('Calculated age: 9 days.')).toBeInTheDocument();
    expect(screen.getByText('Applies to this scan only.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter age here')).toBeInTheDocument();
  });

  it('greys out everything inside an open box while scanning', () => {
    const { rerender } = render(
      <PlantAgeNote
        wave={wave}
        calculatedAge={9}
        change={null}
        onChange={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('change-age'));
    rerender(
      <PlantAgeNote
        wave={wave}
        calculatedAge={9}
        change={null}
        onChange={vi.fn()}
        disabled
      />
    );
    expect(screen.getByTestId('change-age-input')).toBeDisabled();
    expect(screen.getByTestId('change-age-reason')).toBeDisabled();
    expect(screen.getByTestId('change-age-confirm')).toBeDisabled();
    expect(screen.getByText('Cancel')).toBeDisabled();
  });

  it('reports when the box opens and closes', () => {
    const onOpenChange = vi.fn();
    render(
      <PlantAgeNote
        wave={wave}
        calculatedAge={9}
        change={null}
        onChange={vi.fn()}
        onOpenChange={onOpenChange}
      />
    );
    fireEvent.click(screen.getByTestId('change-age'));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
