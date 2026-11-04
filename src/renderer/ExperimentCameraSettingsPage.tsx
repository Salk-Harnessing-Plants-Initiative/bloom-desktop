/**
 * Camera Settings for one experiment (#483), opened from Capture Scan when the
 * experiment's settings need a check, or with Change. The operator sets them with the
 * live preview beside them and the settings used before in the experiment; Confirm and
 * return goes back to Capture Scan, where the experiment and phenotyper are still chosen.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Streamer } from '../components/Streamer';
import type { CameraValues } from '../types/experiment-camera-settings';
import { CameraSettingsCheckPanel } from './components/CameraSettingsCheckPanel';
import { useExperimentCameraSettings } from './hooks/useExperimentCameraSettings';
import { useStationScansDir } from './hooks/useStationScansDir';

export interface ExperimentCameraSettingsPageProps {
  experimentId: string;
  phenotyperId: string;
}

export const BACK_TO_CAPTURE_SCAN = '/capture-scan';

export function ExperimentCameraSettingsPage({
  experimentId,
  phenotyperId,
}: ExperimentCameraSettingsPageProps) {
  const navigate = useNavigate();
  const camera = useExperimentCameraSettings(experimentId, phenotyperId);
  const scansDir = useStationScansDir();
  const [preview, setPreview] = useState<CameraValues | null>(null);
  // A stable object, so the stream only restarts when a value changes.
  const previewSettings = useMemo(
    () => (preview ? { ...preview } : null),
    [preview?.exposure_time, preview?.gain, preview?.gamma]
  );

  const confirm = async (values: CameraValues, note: string) => {
    const error = await camera.confirm(values, note);
    if (!error) navigate(BACK_TO_CAPTURE_SCAN);
    return error;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="mb-2 text-3xl font-bold text-gray-800">
              Camera settings for {camera.experimentName || 'this experiment'}
            </h1>
            <p className="text-gray-600">
              These are this experiment&apos;s settings: every scan of it uses
              them. Check the live preview with a plant in the scanner.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Link
              to={BACK_TO_CAPTURE_SCAN}
              className="whitespace-nowrap rounded-md border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 hover:bg-gray-50"
            >
              Back to Capture Scan
            </Link>
            <Link
              to="/camera-settings?station=1"
              className="text-sm text-gray-500 underline hover:text-gray-700"
            >
              Station camera settings
            </Link>
          </div>
        </div>

        {/* Settings in a narrow column, the preview filling the rest. */}
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
          <div>
            {camera.loadError ? (
              <div className="rounded-lg bg-white p-6 shadow-sm">
                <p role="alert" className="font-medium text-red-600">
                  Couldn&apos;t load this experiment&apos;s camera settings:{' '}
                  {camera.loadError}
                </p>
                <button
                  type="button"
                  onClick={camera.reload}
                  className="mt-3 rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50"
                >
                  Retry
                </button>
              </div>
            ) : camera.status ? (
              <CameraSettingsCheckPanel
                experimentName={camera.experimentName || 'this experiment'}
                status={camera.status}
                reference={camera.reference}
                scansDir={scansDir}
                onPreview={setPreview}
                onConfirm={confirm}
                confirmLabel="Confirm and return to Capture Scan"
                showTitle={false}
                stacked
              />
            ) : (
              <p className="text-gray-500">
                Loading this experiment&apos;s camera settings…
              </p>
            )}
          </div>

          <div className="rounded-lg bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-xl font-semibold text-gray-800">
              Live Preview
            </h2>
            {previewSettings ? (
              <div>
                <Streamer
                  settings={previewSettings}
                  width={800}
                  height={600}
                  showFps={true}
                  fitWidth
                />
              </div>
            ) : (
              <p className="text-gray-500">
                The preview starts with the values on the left.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
