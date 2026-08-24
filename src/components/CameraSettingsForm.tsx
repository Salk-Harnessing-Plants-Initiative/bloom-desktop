/**
 * Camera Settings Form Component
 *
 * Reusable form for configuring camera settings with sliders + inputs.
 * Can be used in Camera Settings page and CaptureScan page.
 */

import React from 'react';
import type { CameraSettings } from '../types/camera';

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
}

export const CameraSettingsForm: React.FC<CameraSettingsFormProps> = ({
  settings,
  onChange,
  onApply,
  onReset,
  showActions = true,
  readOnly = false,
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
            min="100"
            max="50000"
            step="100"
            value={settings.exposure_time || 10000}
            onChange={(e) =>
              handleSliderChange('exposure_time', parseInt(e.target.value))
            }
            disabled={readOnly}
            className="flex-1"
          />
          <input
            type="number"
            value={settings.exposure_time || 10000}
            onChange={(e) => handleInputChange('exposure_time', e.target.value)}
            disabled={readOnly}
            className="w-24 px-2 py-1 border border-gray-300 rounded"
          />
        </div>
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
            min="36"
            max="512"
            step="1"
            value={settings.gain || 100}
            onChange={(e) =>
              handleSliderChange('gain', parseInt(e.target.value, 10))
            }
            disabled={readOnly}
            className="flex-1"
          />
          <input
            type="number"
            value={settings.gain || 100}
            onChange={(e) => handleInputChange('gain', e.target.value)}
            disabled={readOnly}
            className="w-24 px-2 py-1 border border-gray-300 rounded"
            step="1"
          />
        </div>
        <p className="text-xs text-gray-500">
          GainRaw (36–512). Amplifies image brightness. Higher = more noise.
        </p>
      </div>

      {/* Gamma */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Gamma</label>
        <div className="flex gap-3 items-center">
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={settings.gamma || 1.0}
            onChange={(e) =>
              handleSliderChange('gamma', parseFloat(e.target.value))
            }
            disabled={readOnly}
            className="flex-1"
          />
          <input
            type="number"
            value={settings.gamma || 1.0}
            onChange={(e) => handleInputChange('gamma', e.target.value)}
            disabled={readOnly}
            className="w-24 px-2 py-1 border border-gray-300 rounded"
            step="0.1"
          />
        </div>
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
            className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold text-lg shadow-md hover:shadow-lg transition-all"
            style={{ color: 'white', backgroundColor: '#16a34a' }}
          >
            Apply Settings
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
