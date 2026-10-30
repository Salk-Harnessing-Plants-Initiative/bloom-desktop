/**
 * Camera Settings Form Component
 *
 * Reusable form for configuring camera settings with sliders + inputs.
 * Can be used in Camera Settings page and CaptureScan page.
 */

import React from 'react';
import {
  CAMERA_SETTING_LIMITS,
  cameraSettingsErrors,
  DEFAULT_CAMERA_SETTINGS,
  type CameraSettings,
  type LimitedCameraSetting,
} from '../types/camera';

export interface CameraSettingsFormProps {
  /** Current settings */
  settings: Partial<CameraSettings>;

  /** Callback when settings change */
  onChange: (settings: Partial<CameraSettings>) => void;

  /** Callback when Apply is clicked */
  onApply?: () => void;

  /** Callback when Reset is clicked */
  onReset?: () => void;

  /** Whether Apply/Reset buttons are visible */
  showActions?: boolean;

  /** Read-only mode (for review in CaptureScan) */
  readOnly?: boolean;

  /** An Apply is in progress: the button waits until it's done. */
  applying?: boolean;
}

export const CameraSettingsForm: React.FC<CameraSettingsFormProps> = ({
  settings,
  onChange,
  onApply,
  onReset,
  showActions = true,
  readOnly = false,
  applying = false,
}) => {
  const handleSliderChange = (field: keyof CameraSettings, value: number) => {
    onChange({ ...settings, [field]: value });
  };

  const handleInputChange = (field: keyof CameraSettings, value: string) => {
    // Gain must be integer (GainRaw on Basler acA2000-50gm)
    const numValue = field === 'gain' ? parseInt(value, 10) : parseFloat(value);
    if (!isNaN(numValue)) {
      onChange({ ...settings, [field]: numValue });
    }
  };

  // Values the camera or the saved-settings file would refuse; Apply waits until they're fixed.
  const errors = readOnly ? {} : cameraSettingsErrors(settings);
  const hasErrors = Object.keys(errors).length > 0;
  const numberBoxClass = (field: LimitedCameraSetting) =>
    `w-24 px-2 py-1 border rounded ${
      errors[field] ? 'border-red-500 bg-red-50' : 'border-gray-300'
    }`;
  const fieldError = (field: LimitedCameraSetting) =>
    errors[field] ? (
      <p role="alert" className="text-xs font-medium text-red-600">
        {errors[field]}
      </p>
    ) : null;

  return (
    <div className="space-y-6">
      {/* Exposure Time */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Exposure Time (μs)
        </label>
        <div className="flex gap-3 items-center">
          <input
            type="range"
            min={CAMERA_SETTING_LIMITS.exposure_time.min}
            max={CAMERA_SETTING_LIMITS.exposure_time.max}
            step="100"
            value={
              settings.exposure_time ?? DEFAULT_CAMERA_SETTINGS.exposure_time
            }
            onChange={(e) =>
              handleSliderChange('exposure_time', parseInt(e.target.value))
            }
            disabled={readOnly}
            className="flex-1"
          />
          <input
            type="number"
            value={
              settings.exposure_time ?? DEFAULT_CAMERA_SETTINGS.exposure_time
            }
            onChange={(e) => handleInputChange('exposure_time', e.target.value)}
            disabled={readOnly}
            aria-invalid={errors.exposure_time ? true : undefined}
            className={numberBoxClass('exposure_time')}
          />
        </div>
        {fieldError('exposure_time')}
        <p className="text-xs text-gray-500">
          Lower = darker image, faster capture. Higher = brighter, slower.
        </p>
      </div>

      {/* Gain */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Gain</label>
        <div className="flex gap-3 items-center">
          <input
            type="range"
            min={CAMERA_SETTING_LIMITS.gain.min}
            max={CAMERA_SETTING_LIMITS.gain.max}
            step="1"
            value={settings.gain ?? DEFAULT_CAMERA_SETTINGS.gain}
            onChange={(e) =>
              handleSliderChange('gain', parseInt(e.target.value, 10))
            }
            disabled={readOnly}
            className="flex-1"
          />
          <input
            type="number"
            value={settings.gain ?? DEFAULT_CAMERA_SETTINGS.gain}
            onChange={(e) => handleInputChange('gain', e.target.value)}
            disabled={readOnly}
            aria-invalid={errors.gain ? true : undefined}
            className={numberBoxClass('gain')}
            step="1"
          />
        </div>
        {fieldError('gain')}
        <p className="text-xs text-gray-500">
          GainRaw ({CAMERA_SETTING_LIMITS.gain.min}–
          {CAMERA_SETTING_LIMITS.gain.max}). Amplifies image brightness. Higher
          = more noise.
        </p>
      </div>

      {/* Gamma */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Gamma</label>
        <div className="flex gap-3 items-center">
          <input
            type="range"
            min={CAMERA_SETTING_LIMITS.gamma.min}
            max={CAMERA_SETTING_LIMITS.gamma.max}
            step="0.1"
            value={settings.gamma ?? DEFAULT_CAMERA_SETTINGS.gamma}
            onChange={(e) =>
              handleSliderChange('gamma', parseFloat(e.target.value))
            }
            disabled={readOnly}
            className="flex-1"
          />
          <input
            type="number"
            value={settings.gamma ?? DEFAULT_CAMERA_SETTINGS.gamma}
            onChange={(e) => handleInputChange('gamma', e.target.value)}
            disabled={readOnly}
            aria-invalid={errors.gamma ? true : undefined}
            className={numberBoxClass('gamma')}
            step="0.1"
          />
        </div>
        {fieldError('gamma')}
        <p className="text-xs text-gray-500">
          Adjusts tone curve. 1.0 = linear. {'<'}1.0 = darker shadows, {'>'}1.0
          = brighter shadows.
        </p>
      </div>

      {/* Actions */}
      {showActions && !readOnly && (
        <div className="flex gap-3 pt-6 mt-6 border-t-2 border-gray-200">
          <button
            type="button"
            onClick={onApply}
            disabled={hasErrors || applying}
            title={hasErrors ? 'Fix the values marked in red first' : undefined}
            className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold text-lg shadow-md hover:shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-50"
            style={{ color: 'white', backgroundColor: '#16a34a' }}
          >
            {applying ? 'Applying…' : 'Apply Settings'}
          </button>
          <button
            type="button"
            onClick={onReset}
            className="px-6 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 font-semibold shadow-md hover:shadow-lg transition-all"
            style={{ color: 'white', backgroundColor: '#6b7280' }}
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
};
