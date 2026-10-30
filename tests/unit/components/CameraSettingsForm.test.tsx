/**
 * Unit Tests: CameraSettingsForm Component (fix-camera-scan-params 1.7)
 *
 * TDD: Verifies gain slider has correct Basler acA2000-50gm attributes,
 * removed controls (Brightness, Contrast, Width/Height) are absent,
 * and exactly 3 range inputs are rendered.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CameraSettingsForm } from '../../../src/components/CameraSettingsForm';
import { DEFAULT_CAMERA_SETTINGS } from '../../../src/types/camera';

describe('CameraSettingsForm — Basler acA2000-50gm corrections', () => {
  const onChange = vi.fn();

  function renderForm() {
    return render(
      <CameraSettingsForm
        settings={DEFAULT_CAMERA_SETTINGS}
        onChange={onChange}
        showActions={false}
      />
    );
  }

  it('1.7.1 gain slider has min=36, max=512, step=1', () => {
    renderForm();
    // Find the gain range input by looking for the slider in the "Gain" section
    const gainSlider = screen.getAllByRole('slider').find((el) => {
      const parent = el.closest('.space-y-2');
      return (
        parent?.textContent?.includes('Gain') &&
        !parent?.textContent?.includes('Gamma')
      );
    });

    expect(gainSlider).toBeDefined();
    expect(gainSlider).toHaveAttribute('min', '36');
    expect(gainSlider).toHaveAttribute('max', '512');
    expect(gainSlider).toHaveAttribute('step', '1');
  });

  it('1.7.2 gain handleInputChange calls onChange with parseInt result (integer)', () => {
    renderForm();
    // Find the gain number input (spinbox) — not the slider
    const gainSpinbox = screen.getAllByRole('spinbutton').find((el) => {
      const parent = el.closest('.space-y-2');
      return (
        parent?.textContent?.includes('Gain') &&
        !parent?.textContent?.includes('Gamma')
      );
    });

    expect(gainSpinbox).toBeDefined();

    // Simulate typing a float value — onChange should receive an integer
    fireEvent.change(gainSpinbox!, { target: { value: '200.7' } });

    // onChange should have been called with gain as an integer (parseInt truncates)
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.gain).toBe(200);
    expect(Number.isInteger(lastCall.gain)).toBe(true);
  });

  it('1.7.3 Brightness control is not rendered', () => {
    renderForm();
    expect(screen.queryByText('Brightness (optional)')).toBeNull();
    expect(screen.queryByText('Brightness')).toBeNull();
  });

  it('1.7.4 Contrast control is not rendered', () => {
    renderForm();
    expect(screen.queryByText('Contrast (optional)')).toBeNull();
    expect(screen.queryByText('Contrast')).toBeNull();
  });

  it('1.7.5 Width/Height controls are not rendered', () => {
    renderForm();
    expect(screen.queryByPlaceholderText('Width (px)')).toBeNull();
    expect(screen.queryByPlaceholderText('Height (px)')).toBeNull();
  });

  it('1.7.6 exactly 3 range inputs rendered (Exposure, Gain, Gamma)', () => {
    renderForm();
    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(3);
  });
});

describe('CameraSettingsForm limits', () => {
  function renderWith(settings: Record<string, number>, onApply = vi.fn()) {
    render(
      <CameraSettingsForm
        settings={settings}
        onChange={vi.fn()}
        onApply={onApply}
        onReset={vi.fn()}
      />
    );
    return onApply;
  }

  it.each([
    [
      { exposure_time: 60000, gain: 100, gamma: 1 },
      'Exposure must be between 100 and 50,000 µs.',
    ],
    [
      { exposure_time: 10000, gain: 600, gamma: 1 },
      'Gain must be a whole number between 36 and 512.',
    ],
    [
      { exposure_time: 10000, gain: 100.5, gamma: 1 },
      'Gain must be a whole number between 36 and 512.',
    ],
    [
      { exposure_time: 10000, gain: 100, gamma: 2.5 },
      'Gamma must be between 0.5 and 2.0.',
    ],
  ])('marks %o and says why, and Apply is disabled', (settings, message) => {
    const onApply = renderWith(settings);

    expect(screen.getByRole('alert')).toHaveTextContent(message);
    const apply = screen.getByRole('button', { name: /Apply Settings/i });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('disables Apply and says so while an Apply is in progress', () => {
    const onApply = vi.fn();
    render(
      <CameraSettingsForm
        settings={{ exposure_time: 10000, gain: 100, gamma: 1 }}
        onChange={vi.fn()}
        onApply={onApply}
        onReset={vi.fn()}
        applying
      />
    );

    const apply = screen.getByRole('button', { name: 'Applying…' });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('keeps a gamma below 1 as typed (no fallback to the default)', () => {
    const onChange = vi.fn();
    render(
      <CameraSettingsForm
        settings={{ exposure_time: 10000, gain: 100, gamma: 0 }}
        onChange={onChange}
        showActions={false}
      />
    );
    // Typing "0.8" passes through 0 on the way; 0 must not become the default 1.
    expect(screen.getAllByRole('spinbutton')[2]).toHaveValue(0);

    fireEvent.change(screen.getAllByRole('spinbutton')[2], {
      target: { value: '0.8' },
    });
    expect(onChange.mock.lastCall?.[0].gamma).toBe(0.8);
  });

  it('allows Apply when every value is within the limits', () => {
    renderWith({ exposure_time: 10000, gain: 100, gamma: 1 });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Apply Settings/i })
    ).toBeEnabled();
  });
});
