/**
 * Camera Settings with no experiment chosen on Capture Scan (#483). Settings belong to
 * an experiment, so there is nothing to edit yet: the page says where to choose one,
 * and keeps the live preview so the operator can still check the camera works.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Streamer } from '../components/Streamer';
import { type CameraSettings, withoutSource } from '../types/camera';
import { BACK_TO_CAPTURE_SCAN } from './ExperimentCameraSettingsPage';

export function NoExperimentCameraSettings() {
  // The preview uses the station's saved settings; without any, the camera's own.
  // undefined while loading, so the stream doesn't start twice.
  const [preview, setPreview] = useState<
    Partial<CameraSettings> | null | undefined
  >(undefined);
  useEffect(() => {
    let cancelled = false;
    window.electron.camera
      .getSettings()
      .then((saved) => {
        if (!cancelled) setPreview(saved ? withoutSource(saved) : null);
      })
      .catch(() => {
        // The preview is only a camera check: without saved settings it still runs.
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <h1 className="text-3xl font-bold text-gray-800">Camera settings</h1>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
          <div
            className="rounded-lg bg-white p-6 shadow-sm"
            data-testid="no-experiment-camera-settings"
          >
            <p className="font-medium text-gray-800">No experiment selected.</p>
            <p className="mt-1 text-sm text-gray-600">
              Choose an experiment and phenotyper on the Capture Scan page to
              view or set its camera settings.
            </p>
            <Link
              to={BACK_TO_CAPTURE_SCAN}
              className="mt-4 inline-block rounded-md bg-lime-700 px-4 py-2 font-medium text-white hover:bg-lime-800"
            >
              Go to Capture Scan
            </Link>
          </div>

          <div className="rounded-lg bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-xl font-semibold text-gray-800">
              Live Preview
            </h2>
            {preview !== undefined && (
              <Streamer
                settings={preview ?? undefined}
                width={800}
                height={600}
                showFps={true}
                fitWidth
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
