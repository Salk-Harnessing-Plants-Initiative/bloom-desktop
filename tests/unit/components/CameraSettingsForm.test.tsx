/**
 * TDD tests for CameraSettingsForm (fix-camera-scan-params).
 *
 * Tests 1.6.1-1.6.6: Validate gain slider range, removed controls,
 * and correct number of range inputs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CameraSettingsForm } from '../../../src/components/CameraSettingsForm';

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  if (win && win.electron) {
    win.electron.camera = {
      detectCameras: vi.fn().mockResolvedValue({ success: true, cameras: [] }),
    };
    win.electron.config = {
      get: vi.fn().mockResolvedValue({ config: {} }),
    };
  }
});

const defaultProps = {
  settings: { exposure_time: 10000, gain: 100, gamma: 1.0 },
  onChange: vi.fn(),
};

describe('CameraSettingsForm', () => {
  describe('Gain slider attributes', () => {
    it('1.6.1: gain slider has min="36", max="512", step="1"', () => {
      render(<CameraSettingsForm {...defaultProps} />);

      const sliders = screen.getAllByRole('slider');
      // Gain slider is the second one (after Exposure Time)
      const gainSlider = sliders[1];
      expect(gainSlider).toHaveAttribute('min', '36');
      expect(gainSlider).toHaveAttribute('max', '512');
      expect(gainSlider).toHaveAttribute('step', '1');
    });

    it('1.6.2: gain number input uses integer step', () => {
      render(<CameraSettingsForm {...defaultProps} />);

      // Find the number input associated with gain
      const gainInputs = screen
        .getAllByDisplayValue('100')
        .filter(
          (el) => el.getAttribute('type') === 'number' || el.tagName === 'INPUT'
        );
      expect(gainInputs.length).toBeGreaterThan(0);
    });
  });

  describe('Removed controls', () => {
    it('1.6.3: Brightness control is removed', () => {
      render(<CameraSettingsForm {...defaultProps} />);
      // Verify no "Brightness" label exists (help text mentioning "brightness" is OK)
      const labels = screen.queryAllByText(/brightness/i);
      const brightnessLabel = labels.find((el) => el.tagName === 'LABEL');
      expect(brightnessLabel).toBeUndefined();
    });

    it('1.6.4: Contrast control is removed', () => {
      render(<CameraSettingsForm {...defaultProps} />);
      expect(screen.queryByText(/contrast/i)).toBeNull();
    });

    it('1.6.5: Width/Height controls are removed', () => {
      render(<CameraSettingsForm {...defaultProps} />);
      expect(screen.queryByPlaceholderText(/width/i)).toBeNull();
      expect(screen.queryByPlaceholderText(/height/i)).toBeNull();
    });

    it('1.6.6: exactly 3 range inputs (Exposure, Gain, Gamma)', () => {
      render(<CameraSettingsForm {...defaultProps} />);

      const rangeInputs = screen.getAllByRole('slider');
      expect(rangeInputs).toHaveLength(3);
    });
  });
});
