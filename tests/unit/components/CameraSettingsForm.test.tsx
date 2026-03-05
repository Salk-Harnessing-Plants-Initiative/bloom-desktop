/**
 * Unit Tests: CameraSettingsForm Component — Scan Parameter Controls
 *
 * Tests for seconds_per_rot and num_frames slider+input controls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CameraSettingsForm } from '../../../src/components/CameraSettingsForm';
import {
  DEFAULT_CAMERA_SETTINGS,
  type CameraSettings,
} from '../../../src/types/camera';

// Mock window.electron APIs used by CameraSettingsForm
beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  if (win) {
    win.electron = {
      ...win.electron,
      config: {
        get: vi.fn().mockResolvedValue({ config: {} }),
      },
      camera: {
        detectCameras: vi
          .fn()
          .mockResolvedValue({ success: true, cameras: [] }),
        getStatus: vi.fn().mockResolvedValue({ connected: false }),
        getSettings: vi.fn().mockResolvedValue(null),
      },
    };
  }
});

describe('CameraSettingsForm — Scan Parameter Controls', () => {
  const defaultSettings: Partial<CameraSettings> = {
    ...DEFAULT_CAMERA_SETTINGS,
  };

  it('renders seconds_per_rot slider+input with correct range (4-10) and default (7)', () => {
    const onChange = vi.fn();
    render(
      <CameraSettingsForm
        settings={defaultSettings}
        onChange={onChange}
        showCameraSelection={false}
        showActions={false}
      />
    );

    expect(screen.getByText('Seconds per Rotation')).toBeInTheDocument();

    // Find the slider for seconds_per_rot
    const sliders = screen.getAllByRole('slider');
    const secPerRotSlider = sliders.find(
      (s) => s.getAttribute('min') === '4' && s.getAttribute('max') === '10'
    );
    expect(secPerRotSlider).toBeDefined();
    expect(secPerRotSlider!.getAttribute('step')).toBe('0.5');
    expect((secPerRotSlider as HTMLInputElement).value).toBe('7');

    // Find the number input for seconds_per_rot
    const numberInputs = screen.getAllByRole('spinbutton');
    const secPerRotInput = numberInputs.find(
      (input) => (input as HTMLInputElement).value === '7'
    );
    expect(secPerRotInput).toBeDefined();
  });

  it('renders num_frames slider+input with correct range (12-360) and default (72)', () => {
    const onChange = vi.fn();
    render(
      <CameraSettingsForm
        settings={defaultSettings}
        onChange={onChange}
        showCameraSelection={false}
        showActions={false}
      />
    );

    expect(screen.getByText('Frames per Rotation')).toBeInTheDocument();

    const sliders = screen.getAllByRole('slider');
    const numFramesSlider = sliders.find(
      (s) => s.getAttribute('min') === '12' && s.getAttribute('max') === '360'
    );
    expect(numFramesSlider).toBeDefined();
    expect(numFramesSlider!.getAttribute('step')).toBe('1');
    expect((numFramesSlider as HTMLInputElement).value).toBe('72');

    const numberInputs = screen.getAllByRole('spinbutton');
    const numFramesInput = numberInputs.find(
      (input) => (input as HTMLInputElement).value === '72'
    );
    expect(numFramesInput).toBeDefined();
  });

  it('seconds_per_rot input change calls onChange with updated value', () => {
    const onChange = vi.fn();
    render(
      <CameraSettingsForm
        settings={defaultSettings}
        onChange={onChange}
        showCameraSelection={false}
        showActions={false}
      />
    );

    const numberInputs = screen.getAllByRole('spinbutton');
    const secPerRotInput = numberInputs.find(
      (input) => (input as HTMLInputElement).value === '7'
    )!;

    fireEvent.change(secPerRotInput, { target: { value: '5' } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ seconds_per_rot: 5 })
    );
  });

  it('num_frames input change calls onChange with updated value', () => {
    const onChange = vi.fn();
    render(
      <CameraSettingsForm
        settings={defaultSettings}
        onChange={onChange}
        showCameraSelection={false}
        showActions={false}
      />
    );

    const numberInputs = screen.getAllByRole('spinbutton');
    const numFramesInput = numberInputs.find(
      (input) => (input as HTMLInputElement).value === '72'
    )!;

    fireEvent.change(numFramesInput, { target: { value: '36' } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ num_frames: 36 })
    );
  });

  it('seconds_per_rot and num_frames inputs are disabled in readOnly mode', () => {
    const onChange = vi.fn();
    render(
      <CameraSettingsForm
        settings={defaultSettings}
        onChange={onChange}
        readOnly={true}
        showCameraSelection={false}
        showActions={false}
      />
    );

    const sliders = screen.getAllByRole('slider');
    const secPerRotSlider = sliders.find(
      (s) => s.getAttribute('min') === '4' && s.getAttribute('max') === '10'
    );
    const numFramesSlider = sliders.find(
      (s) => s.getAttribute('min') === '12' && s.getAttribute('max') === '360'
    );

    expect(secPerRotSlider).toBeDisabled();
    expect(numFramesSlider).toBeDisabled();

    // Number inputs should also be disabled
    const numberInputs = screen.getAllByRole('spinbutton');
    const secPerRotInput = numberInputs.find(
      (input) => (input as HTMLInputElement).value === '7'
    );
    const numFramesInput = numberInputs.find(
      (input) => (input as HTMLInputElement).value === '72'
    );
    expect(secPerRotInput).toBeDisabled();
    expect(numFramesInput).toBeDisabled();
  });
});

describe('DEFAULT_CAMERA_SETTINGS', () => {
  it('includes num_frames=72 and seconds_per_rot=7', () => {
    expect(DEFAULT_CAMERA_SETTINGS.num_frames).toBe(72);
    expect(DEFAULT_CAMERA_SETTINGS.seconds_per_rot).toBe(7);
  });
});
