/**
 * Camera Settings Form Component
 *
 * Reusable form for configuring camera settings with sliders + inputs.
 * Can be used in Camera Settings page and CaptureScan page.
 */

import React, { useState, useEffect } from 'react';
import type { CameraSettings, DetectedCamera } from '../types/camera';

export interface CameraSettingsFormProps {
  /** Current settings */
  settings: Partial<CameraSettings>;

  /** Callback when settings change */
  onChange: (settings: Partial<CameraSettings>) => void;

  /** Callback when Apply is clicked */
  onApply?: () => void;

  /** Callback when Reset is clicked */
  onReset?: () => void;

  /** Whether to show camera selection */
  showCameraSelection?: boolean;

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
  showCameraSelection = true,
  showActions = true,
  readOnly = false,
}) => {
  const [detectedCameras, setDetectedCameras] = useState<DetectedCamera[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Detect cameras on mount
  useEffect(() => {
    if (showCameraSelection && !readOnly) {
      handleDetectCameras();
    }
  }, [showCameraSelection, readOnly]);

  const handleDetectCameras = async () => {
    setIsDetecting(true);
    try {
      const result = await window.electron.camera.detectCameras();
      if (result.success && result.cameras) {
        setDetectedCameras(result.cameras);

        // Select mock camera by default
        const mockCamera = result.cameras.find((c) => c.is_mock);
        if (mockCamera) {
          setSelectedCamera(mockCamera.ip_address);
          onChange({ ...settings, camera_ip_address: mockCamera.ip_address });
        }
      }
    } catch (err) {
      console.error('Failed to detect cameras:', err);
    } finally {
      setIsDetecting(false);
    }
  };

  const handleCameraSelect = (cameraIp: string) => {
    if (cameraIp === 'manual') {
      setShowManualEntry(true);
      setSelectedCamera('');
    } else {
      setShowManualEntry(false);
      setSelectedCamera(cameraIp);
      onChange({ ...settings, camera_ip_address: cameraIp });
    }
  };

  const handleSliderChange = (field: keyof CameraSettings, value: number) => {
    onChange({ ...settings, [field]: value });
  };

  const handleInputChange = (field: keyof CameraSettings, value: string) => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
      onChange({ ...settings, [field]: numValue });
    }
  };

  return (
    <div className="space-y-6">
      {/* Camera Selection */}
      {showCameraSelection && !readOnly && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Camera
          </label>

          <div className="flex gap-2">
            <button
              onClick={handleDetectCameras}
              disabled={isDetecting}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
            >
              {isDetecting ? 'Detecting...' : 'Detect Cameras'}
            </button>
          </div>

          {detectedCameras.length > 0 && (
            <select
              value={showManualEntry ? 'manual' : selectedCamera}
              onChange={(e) => handleCameraSelect(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {detectedCameras.map((camera) => (
                <option key={camera.ip_address} value={camera.ip_address}>
                  {camera.friendly_name}
                </option>
              ))}
              <option value="manual">Manual Entry...</option>
            </select>
          )}

          {(showManualEntry || detectedCameras.length === 0) && (
            <div className="space-y-1">
              <input
                type="text"
                placeholder="192.168.1.100 (or leave empty for mock)"
                value={settings.camera_ip_address || ''}
                onChange={(e) =>
                  onChange({ ...settings, camera_ip_address: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500">
                Leave empty to use mock camera
              </p>
            </div>
          )}

          {/* Help Text (Collapsible) */}
          <div className="border-t pt-2">
            <button
              onClick={() => setShowHelp(!showHelp)}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              {showHelp ? '▼' : '▶'} How to find camera IP address
            </button>

            {showHelp && (
              <div className="mt-2 p-3 bg-gray-50 rounded text-sm space-y-2">
                <p className="font-medium">
                  Method 1: Basler Pylon Viewer (Recommended)
                </p>
                <ol className="list-decimal ml-5 space-y-1">
                  <li>Open Basler Pylon Viewer software</li>
                  <li>Right-click camera → Properties</li>
                  <li>View IP Address in properties panel</li>
                </ol>

                <p className="font-medium mt-3">Method 2: Check Camera Label</p>
                <p>Physical label on camera may show IP address</p>

                <p className="font-medium mt-3">Method 3: Router Admin Page</p>
                <p>
                  Check connected devices in router settings (usually
                  192.168.1.1)
                </p>

                <p className="text-gray-600 mt-3">
                  <strong>Note:</strong> Mock camera doesn't require an IP
                  address. Detection button should show it automatically.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

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
            min="0"
            max="20"
            step="0.1"
            value={settings.gain || 0}
            onChange={(e) =>
              handleSliderChange('gain', parseFloat(e.target.value))
            }
            disabled={readOnly}
            className="flex-1"
          />
          <input
            type="number"
            value={settings.gain || 0}
            onChange={(e) => handleInputChange('gain', e.target.value)}
            disabled={readOnly}
            className="w-24 px-2 py-1 border border-gray-300 rounded"
            step="0.1"
          />
        </div>
        <p className="text-xs text-gray-500">
          Amplifies image brightness. Higher = more noise.
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

      {/* Brightness (optional) */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Brightness (optional)
        </label>
        <div className="flex gap-3 items-center">
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={settings.brightness || 0.5}
            onChange={(e) =>
              handleSliderChange('brightness', parseFloat(e.target.value))
            }
            disabled={readOnly}
            className="flex-1"
          />
          <input
            type="number"
            value={settings.brightness || 0.5}
            onChange={(e) => handleInputChange('brightness', e.target.value)}
            disabled={readOnly}
            className="w-24 px-2 py-1 border border-gray-300 rounded"
            step="0.01"
          />
        </div>
      </div>

      {/* Contrast (optional) */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Contrast (optional)
        </label>
        <div className="flex gap-3 items-center">
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={settings.contrast || 1.0}
            onChange={(e) =>
              handleSliderChange('contrast', parseFloat(e.target.value))
            }
            disabled={readOnly}
            className="flex-1"
          />
          <input
            type="number"
            value={settings.contrast || 1.0}
            onChange={(e) => handleInputChange('contrast', e.target.value)}
            disabled={readOnly}
            className="w-24 px-2 py-1 border border-gray-300 rounded"
            step="0.1"
          />
        </div>
      </div>

      {/* Image Size (optional) */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Image Size (optional - leave empty for camera default)
        </label>
        <div className="flex gap-3">
          <div className="flex-1">
            <input
              type="number"
              placeholder="Width (px)"
              value={settings.width || ''}
              onChange={(e) => handleInputChange('width', e.target.value)}
              disabled={readOnly}
              className="w-full px-3 py-2 border border-gray-300 rounded"
            />
          </div>
          <div className="flex-1">
            <input
              type="number"
              placeholder="Height (px)"
              value={settings.height || ''}
              onChange={(e) => handleInputChange('height', e.target.value)}
              disabled={readOnly}
              className="w-full px-3 py-2 border border-gray-300 rounded"
            />
          </div>
        </div>
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
