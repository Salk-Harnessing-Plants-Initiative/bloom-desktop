/**
 * Camera Settings Page
 *
 * Configure camera settings with live preview.
 * Settings are applied to streaming and persist to backend.
 */

import { useState, useEffect } from 'react';
import { Streamer } from '../components/Streamer';
import { CameraSettingsForm } from '../components/CameraSettingsForm';
import type { CameraSettings } from '../types/camera';

export function CameraSettings() {
  const [currentSettings, setCurrentSettings] = useState<
    Partial<CameraSettings>
  >({
    exposure_time: 10000,
    gain: 0.0,
    gamma: 1.0,
    brightness: 0.5,
    contrast: 1.0,
  });

  const [editedSettings, setEditedSettings] = useState(currentSettings);
  const [isDirty, setIsDirty] = useState(false);
  const [streamKey, setStreamKey] = useState(0);
  const [lastApplied, setLastApplied] = useState<Date | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Track if settings have changed
  useEffect(() => {
    const changed =
      JSON.stringify(currentSettings) !== JSON.stringify(editedSettings);
    setIsDirty(changed);
  }, [currentSettings, editedSettings]);

  // Cleanup: Stop streaming when unmounting
  useEffect(() => {
    return () => {
      if (showPreview) {
        window.electron.camera.stopStream().catch((err) => {
          console.error('Failed to stop stream on unmount:', err);
        });
      }
    };
  }, [showPreview]);

  const handleApply = async () => {
    try {
      // Save to backend
      await window.electron.camera.configure(editedSettings);

      // Update current settings
      setCurrentSettings(editedSettings);

      // Show preview and force streamer remount with new settings
      setShowPreview(true);
      setStreamKey((prev) => prev + 1);

      setIsDirty(false);
      setLastApplied(new Date());
    } catch (error) {
      console.error('Failed to apply settings:', error);
      alert('Failed to apply settings: ' + error);
    }
  };

  const handleReset = () => {
    setEditedSettings(currentSettings);
    setIsDirty(false);
  };

  const formatTimeAgo = (date: Date | null) => {
    if (!date) return 'Never';
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-2 text-gray-800">
        Camera Settings & Live Preview
      </h1>
      <p className="text-gray-600 mb-8">
        Configure camera settings and see changes in real-time. Settings are
        applied to streaming and saved for future scans.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column: Settings Form */}
        <div className="bg-white p-6 rounded-lg shadow max-h-[calc(100vh-12rem)] overflow-y-auto">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Settings</h2>

          <CameraSettingsForm
            settings={editedSettings}
            onChange={setEditedSettings}
            onApply={handleApply}
            onReset={handleReset}
            showCameraSelection={true}
            showActions={true}
          />

          {/* Status Info */}
          <div className="mt-6 pt-4 border-t border-gray-200">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span
                className={`w-2 h-2 rounded-full ${isDirty ? 'bg-yellow-500' : 'bg-green-500'}`}
              />
              {isDirty ? 'Unsaved changes' : 'Settings saved'}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Last applied: {formatTimeAgo(lastApplied)}
            </p>
          </div>
        </div>

        {/* Right Column: Live Preview */}
        <div className="bg-white p-6 rounded-lg shadow max-h-[calc(100vh-12rem)] overflow-y-auto">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">
            Live Preview
          </h2>

          {showPreview ? (
            <div className="flex justify-center">
              <Streamer
                key={streamKey}
                settings={currentSettings}
                width={800}
                height={600}
                showFps={true}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center bg-gray-100 rounded-lg" style={{ width: 800, height: 600 }}>
              <div className="text-center p-8">
                <svg
                  className="mx-auto h-16 w-16 text-gray-400 mb-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                <p className="text-lg font-medium text-gray-700 mb-2">
                  No Preview Active
                </p>
                <p className="text-sm text-gray-500">
                  Configure camera settings and click "Apply Settings" to start live preview
                </p>
              </div>
            </div>
          )}

          <p className="text-sm text-gray-600 mt-4">
            {showPreview
              ? 'Adjust settings on the left and click "Apply Settings" to see changes in the preview.'
              : 'Click "Apply Settings" to start the camera preview with your configured settings.'}
          </p>
        </div>
      </div>
    </div>
  );
}
