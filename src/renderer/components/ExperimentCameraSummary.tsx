/**
 * Capture Scan's line about the selected experiment's camera settings (#483): what
 * scans will use and when they were checked, with Change; or why scanning waits.
 */

import { Link } from 'react-router-dom';
import { formatCameraSetting } from '../../types/camera';
import type { ExperimentCameraSettings } from '../hooks/useExperimentCameraSettings';

export interface ExperimentCameraSummaryProps {
  camera: ExperimentCameraSettings;
  /** Both an experiment and a phenotyper are chosen. */
  chosen: boolean;
  /** A scan is running: settings can't change now. */
  scanning: boolean;
  /** Camera Settings for this experiment and phenotyper. */
  settingsLink: string;
}

function checkedAt(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ExperimentCameraSummary({
  camera,
  chosen,
  scanning,
  settingsLink,
}: ExperimentCameraSummaryProps) {
  // Shown under the experiment dropdown.
  const base = 'mt-2 text-sm';
  if (!chosen) {
    return (
      <p
        className={`${base} text-gray-500`}
        data-testid="experiment-camera-summary"
      >
        Camera settings: choose the experiment and phenotyper first.
      </p>
    );
  }
  if (camera.loadError) {
    return (
      <div className={base} data-testid="experiment-camera-summary">
        <p role="alert" className="font-medium text-red-600">
          Couldn&apos;t load this experiment&apos;s camera settings:{' '}
          {camera.loadError}
        </p>
        <button
          type="button"
          onClick={camera.reload}
          className="mt-2 rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50"
        >
          Retry
        </button>
      </div>
    );
  }
  if (camera.loading && !camera.status) {
    return (
      <p
        className={`${base} text-gray-500`}
        data-testid="experiment-camera-summary"
      >
        Loading this experiment&apos;s camera settings…
      </p>
    );
  }
  if (camera.needsCheck) {
    const name = camera.experimentName || 'this experiment';
    return (
      <div className={base} data-testid="experiment-camera-summary">
        <p className="font-medium text-amber-800">
          Check the camera settings for {name} before scanning.
        </p>
        <Link
          to={settingsLink}
          className="mt-2 inline-block rounded-md bg-lime-700 px-3 py-1.5 font-medium text-white hover:bg-lime-800"
        >
          Check camera settings →
        </Link>
      </div>
    );
  }
  const values = camera.checkedValues;
  const current = camera.status?.current;
  if (!values || !current) return null;
  return (
    <div
      className={`${base} flex items-center justify-between gap-3`}
      data-testid="experiment-camera-summary"
    >
      <p className="text-gray-700">
        <span className="font-medium">Camera:</span>{' '}
        {formatCameraSetting('exposure_time', values.exposure_time)} µs · gain{' '}
        {formatCameraSetting('gain', values.gain)} · gamma{' '}
        {formatCameraSetting('gamma', values.gamma)}
        {camera.experimentName && ` (${camera.experimentName})`}
        <span className="block text-xs text-gray-500">
          Checked today {checkedAt(current.last_confirmed_at)}
          {current.last_confirmed_by_name &&
            ` by ${current.last_confirmed_by_name}`}
        </span>
      </p>
      {scanning ? (
        <span className="rounded-md border border-gray-200 px-3 py-1 font-medium text-gray-400">
          Change
        </span>
      ) : (
        <Link
          to={settingsLink}
          className="rounded-md border border-gray-300 px-3 py-1 font-medium text-gray-700 hover:bg-gray-50"
        >
          Change
        </Link>
      )}
    </div>
  );
}
