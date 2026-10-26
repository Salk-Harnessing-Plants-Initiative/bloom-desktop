/**
 * Unit tests for the Capture Scan germination-date panel and the plant-age note (#407).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WaveDatesPanel } from '../../../src/renderer/components/WaveDatesPanel';
import { toIsoDate } from '../../../src/utils/wave-dates';

/** Local "YYYY-MM-DD" `n` days ago, by calendar arithmetic so DST can't shift it. */
const daysAgo = (n: number) => {
  const now = new Date();
  return toIsoDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - n)
  );
};
const wave1 = { wave_number: 1, germination_date: daysAgo(90) };

/** "Yes": all the wave's plants share their dates, entered once (if not answered yet). */
function answerYes() {
  const yes = screen.queryByTestId(
    'dates-mode-same'
  ) as HTMLInputElement | null;
  if (yes && !yes.checked) fireEvent.click(yes);
}

function renderPanel(waveNumber = 2, waves = [wave1]) {
  const onSave = vi.fn().mockResolvedValue({ success: true });
  render(
    <WaveDatesPanel
      waveNumber={waveNumber}
      waves={waves}
      phenotyperId="ph-1"
      phenotyperName="Demo Phenotyper"
      onSave={onSave}
    />
  );
  const setDate = (value: string) => {
    answerYes();
    fireEvent.change(screen.getByTestId('germination-date-input'), {
      target: { value },
    });
  };
  const setSowing = (value = daysAgo(95)) => {
    answerYes();
    fireEvent.change(screen.getByTestId('sowing-date-input'), {
      target: { value },
    });
  };
  return {
    onSave,
    setDate,
    setSowing,
    save: () => screen.getByTestId('wave-dates-save'),
  };
}

describe('WaveDatesPanel', () => {
  it("asks whether all the wave's plants share their dates, with nothing chosen yet", () => {
    const { save } = renderPanel();
    expect(screen.getByTestId('dates-mode-question')).toHaveTextContent(
      "How are wave 2's dates (sowing date, germination date and transfer to cylinder date) set?"
    );
    expect(screen.getByTestId('dates-mode-same')).not.toBeChecked();
    expect(screen.getByTestId('dates-mode-per-plant')).not.toBeChecked();
    // No dates are asked for until they answer.
    expect(
      screen.queryByTestId('germination-date-input')
    ).not.toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('saves a wave whose dates are per plant, with no dates', async () => {
    const { onSave, save } = renderPanel();
    fireEvent.click(screen.getByTestId('dates-mode-per-plant'));
    expect(screen.getByTestId('dates-per-plant-note')).toHaveTextContent(
      "Each plant's dates are asked for as it's first scanned"
    );
    expect(
      screen.queryByTestId('germination-date-input')
    ).not.toBeInTheDocument();
    fireEvent.click(save());
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        datesPerPlant: true,
        note: undefined,
        phenotyperId: 'ph-1',
      })
    );
  });

  it('keeps the wave-number note on a per-plant wave', async () => {
    const { onSave, save } = renderPanel(5);
    fireEvent.change(screen.getByTestId('wave-number-note'), {
      target: { value: 'Waves 2 to 4 on another PC' },
    });
    fireEvent.click(screen.getByTestId('wave-number-confirm'));
    fireEvent.click(screen.getByTestId('dates-mode-per-plant'));
    fireEvent.click(save());
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          datesPerPlant: true,
          note: 'Waves 2 to 4 on another PC',
        })
      )
    );
  });

  it('saves a germination date after the earlier wave, with who set it', async () => {
    const { onSave, setDate, setSowing, save } = renderPanel();
    expect(save()).toBeDisabled();
    setDate(daysAgo(9));
    // The sowing date is needed too; the transfer is the germination day by default.
    expect(screen.getByText('Enter the sowing date.')).toBeInTheDocument();
    expect(save()).toBeDisabled();
    expect(screen.getByTestId('transfer-same-day')).toBeChecked();
    setSowing();
    fireEvent.click(save());
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        germinationDate: daysAgo(9),
        sowingDate: daysAgo(95),
        transferDate: undefined,
        note: undefined,
        phenotyperId: 'ph-1',
      })
    );
  });

  it('needs a phenotyper before the date can be saved', () => {
    const onSave = vi.fn();
    render(
      <WaveDatesPanel
        waveNumber={2}
        waves={[wave1]}
        phenotyperId=""
        onSave={onSave}
      />
    );
    answerYes();
    fireEvent.change(screen.getByTestId('germination-date-input'), {
      target: { value: daysAgo(9) },
    });
    expect(screen.getByTestId('wave-dates-needs-phenotyper')).toHaveTextContent(
      'Choose the phenotyper first.'
    );
    expect(screen.getByTestId('wave-dates-save')).toBeDisabled();
  });

  it('opens a short note on the germination date from the ⓘ', () => {
    renderPanel();
    answerYes();
    expect(
      screen.queryByTestId('germination-date-info-text')
    ).not.toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByTestId('germination-date-info'));
    expect(screen.getByTestId('germination-date-info-text')).toHaveTextContent(
      'Plant age = days since germination. The germination day is day 0, so a plant that germinated on 1 Oct is 9 days old on 10 Oct.'
    );
    fireEvent.mouseLeave(screen.getByTestId('germination-date-info'));
    expect(
      screen.queryByTestId('germination-date-info-text')
    ).not.toBeInTheDocument();
    // A click opens it too, e.g. on a touchscreen.
    fireEvent.click(screen.getByTestId('germination-date-info'));
    expect(
      screen.getByTestId('germination-date-info-text')
    ).toBeInTheDocument();
  });

  it('refuses a future date', () => {
    const { setDate, save } = renderPanel();
    setDate(daysAgo(-2));
    expect(
      screen.getByText("The germination date can't be in the future.")
    ).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('needs a note for a date on or before wave 1', async () => {
    const { onSave, setDate, setSowing, save } = renderPanel();
    setDate(daysAgo(90));
    setSowing();
    expect(screen.getByTestId('wave-warnings')).toHaveTextContent(
      /^⚠Are you sure wave 2's germination date is correct\?It is on or before wave 1's germination date \(.+\)\.Germination dates of this experiment's other waves:Wave 1: .+If it is correct, add a note saying why, then proceed\.$/
    );
    expect(save()).toBeDisabled();
    expect(save()).toHaveTextContent('Proceed with these dates');
    fireEvent.change(screen.getByTestId('wave-dates-note'), {
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
    const { onSave, setDate, setSowing, save } = renderPanel(5);
    // Only the wave-number question: no date yet.
    expect(screen.getByTestId('wave-number-check')).toHaveTextContent(
      'Is the wave number correct?Previous wave: wave 1.Are you sure you want to scan wave 5?Add a note to continue, or change the wave number above.'
    );
    expect(
      screen.queryByTestId('germination-date-input')
    ).not.toBeInTheDocument();
    const confirm = screen.getByTestId('wave-number-confirm');
    expect(confirm).toHaveTextContent('Yes, wave 5 is correct');
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId('wave-number-note'), {
      target: { value: 'Waves 2 to 4 were scanned on another PC' },
    });
    fireEvent.click(confirm);

    // Then the germination date, with the confirmation shown above it.
    expect(screen.getByTestId('wave-number-confirmed')).toHaveTextContent(
      'Wave 5 confirmed by Demo Phenotyper: Waves 2 to 4 were scanned on another PC'
    );
    setDate(daysAgo(9));
    setSowing();
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
    const { onSave, setDate, setSowing, save } = renderPanel(5);
    fireEvent.change(screen.getByTestId('wave-number-note'), {
      target: { value: 'Waves 2 to 4 on another PC' },
    });
    fireEvent.click(screen.getByTestId('wave-number-confirm'));
    setDate(daysAgo(90));
    setSowing();
    // The date's own question needs its own note.
    expect(save()).toBeDisabled();
    fireEvent.change(screen.getByTestId('wave-dates-note'), {
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
    expect(screen.getByTestId('dates-mode-question')).toBeInTheDocument();
  });

  it('saves a transfer date on another day when "Same day as germination" is unticked', async () => {
    const { onSave, setDate, setSowing, save } = renderPanel();
    setDate(daysAgo(9));
    setSowing();
    fireEvent.click(screen.getByTestId('transfer-same-day'));
    // Unticked, a transfer date is needed.
    expect(save()).toBeDisabled();
    fireEvent.change(screen.getByTestId('transfer-date-input'), {
      target: { value: daysAgo(7) },
    });
    fireEvent.click(save());
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ transferDate: daysAgo(7) })
      )
    );
  });

  it('refuses a sowing date after germination', () => {
    const { setDate, setSowing, save } = renderPanel();
    setDate(daysAgo(9));
    setSowing(daysAgo(5));
    expect(
      screen.getByText('The sowing date must be before the germination date.')
    ).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('shows the error when saving fails', async () => {
    const { onSave, setDate, setSowing, save } = renderPanel();
    onSave.mockResolvedValue({ success: false, error: 'database is locked' });
    setDate(daysAgo(9));
    setSowing();
    fireEvent.click(save());
    expect(await screen.findByText('database is locked')).toBeInTheDocument();
  });
});
