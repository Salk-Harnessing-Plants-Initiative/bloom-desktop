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
      phenotyperName="Demo Phenotyper"
      onSave={onSave}
    />
  );
  const setDate = (value: string) =>
    fireEvent.change(screen.getByTestId('sowing-date-input'), {
      target: { value },
    });
  const pickBasis = (basis = 'transfer') =>
    fireEvent.click(screen.getByTestId(`start-date-basis-${basis}`));
  return {
    onSave,
    setDate,
    pickBasis,
    save: () => screen.getByTestId('sowing-date-save'),
  };
}

describe('WaveSowingDatePanel', () => {
  it('saves a sowing date after the earlier wave, with who set it', async () => {
    const { onSave, setDate, pickBasis, save } = renderPanel();
    expect(save()).toBeDisabled();
    setDate(daysAgo(9));
    // Nothing is chosen for what the date is until the phenotyper picks one.
    expect(screen.getByTestId('start-date-basis-transfer')).not.toBeChecked();
    expect(save()).toBeDisabled();
    pickBasis('transfer');
    fireEvent.click(save());
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        sowingDate: daysAgo(9),
        startDateBasis: 'transfer',
        startDateBasisOther: undefined,
        note: undefined,
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

  it('opens a short note on the start date from the ⓘ', () => {
    renderPanel();
    expect(
      screen.queryByTestId('start-date-info-text')
    ).not.toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByTestId('start-date-info'));
    expect(screen.getByTestId('start-date-info-text')).toHaveTextContent(
      'Plant age = days since this date. This date is day 0, so 12 Oct → 9 days old on 21 Oct.'
    );
    fireEvent.mouseLeave(screen.getByTestId('start-date-info'));
    expect(
      screen.queryByTestId('start-date-info-text')
    ).not.toBeInTheDocument();
    // A click opens it too, e.g. on a touchscreen.
    fireEvent.click(screen.getByTestId('start-date-info'));
    expect(screen.getByTestId('start-date-info-text')).toBeInTheDocument();
  });

  it('refuses a future date', () => {
    const { setDate, save } = renderPanel();
    setDate(daysAgo(-2));
    expect(
      screen.getByText("The start date can't be in the future.")
    ).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('needs a note for a date on or before wave 1', async () => {
    const { onSave, setDate, pickBasis, save } = renderPanel();
    setDate(daysAgo(90));
    pickBasis();
    expect(screen.getByTestId('wave-warnings')).toHaveTextContent(
      /^⚠Are you sure wave 2's start date is correct\?It is on or before wave 1's start date \(.+\)\.Start dates of this experiment's other waves:Wave 1: .+If it is correct, add a note saying why, then proceed\.$/
    );
    expect(save()).toBeDisabled();
    expect(save()).toHaveTextContent('Proceed with this start date');
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

  it('asks whether a skipped-ahead wave number is correct first, on its own, then the date', async () => {
    const { onSave, setDate, pickBasis, save } = renderPanel(5);
    // Only the wave-number question: no date yet.
    expect(screen.getByTestId('wave-number-check')).toHaveTextContent(
      'Is the wave number correct?Previous wave: wave 1.Are you sure you want to scan wave 5?Add a note to continue, or change the wave number above.'
    );
    expect(screen.queryByTestId('sowing-date-input')).not.toBeInTheDocument();
    const confirm = screen.getByTestId('wave-number-confirm');
    expect(confirm).toHaveTextContent('Yes, wave 5 is correct');
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId('wave-number-note'), {
      target: { value: 'Waves 2 to 4 were scanned on another PC' },
    });
    fireEvent.click(confirm);

    // Then the start date, with the confirmation shown above it.
    expect(screen.getByTestId('wave-number-confirmed')).toHaveTextContent(
      'Wave 5 confirmed by Demo Phenotyper: Waves 2 to 4 were scanned on another PC'
    );
    setDate(daysAgo(9));
    pickBasis();
    expect(screen.queryByTestId('wave-warnings')).not.toBeInTheDocument();
    fireEvent.click(save());
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          note: 'Waves 2 to 4 were scanned on another PC',
        })
      )
    );
  });

  it('keeps both notes when the wave number skips ahead and the date is out of order', async () => {
    const { onSave, setDate, pickBasis, save } = renderPanel(5);
    fireEvent.change(screen.getByTestId('wave-number-note'), {
      target: { value: 'Waves 2 to 4 on another PC' },
    });
    fireEvent.click(screen.getByTestId('wave-number-confirm'));
    setDate(daysAgo(90));
    pickBasis();
    // The date's own question needs its own note.
    expect(save()).toBeDisabled();
    fireEvent.change(screen.getByTestId('sowing-date-note'), {
      target: { value: 'Sown with wave 1' },
    });
    fireEvent.click(save());
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          note: 'Waves 2 to 4 on another PC; Sown with wave 1',
        })
      )
    );
  });

  it('asks nothing about the wave number for the next wave', () => {
    renderPanel(2);
    expect(screen.queryByTestId('wave-number-check')).not.toBeInTheDocument();
    expect(screen.getByTestId('sowing-date-input')).toBeInTheDocument();
  });

  it('asks what an "Other" start date is, and saves the description', async () => {
    const { onSave, setDate, pickBasis, save } = renderPanel();
    setDate(daysAgo(9));
    pickBasis('other');
    expect(save()).toBeDisabled();
    fireEvent.change(screen.getByTestId('start-date-basis-other-text'), {
      target: { value: ' two days after germination ' },
    });
    fireEvent.click(save());
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          startDateBasis: 'other',
          startDateBasisOther: 'two days after germination',
        })
      )
    );
  });

  it('shows the error when saving fails', async () => {
    const { onSave, setDate, pickBasis, save } = renderPanel();
    onSave.mockResolvedValue({ success: false, error: 'database is locked' });
    setDate(daysAgo(9));
    pickBasis();
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
      /Calculated from wave 1's start date/
    );
  });

  it('offers no Change age once the sowing date was changed, and says why', () => {
    render(
      <PlantAgeNote
        wave={wave}
        calculatedAge={9}
        change={null}
        onChange={vi.fn()}
        lockedMessage="The start date was changed."
      />
    );
    expect(screen.queryByTestId('change-age')).not.toBeInTheDocument();
    expect(screen.getByTestId('change-age-locked')).toHaveTextContent(
      'The start date was changed.'
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
