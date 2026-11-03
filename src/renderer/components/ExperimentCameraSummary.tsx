/**
 * Capture Scan's line about the selected experiment's camera settings (#483): what
 * scans will use and when they were checked, with Change; or why scanning waits.
 */

import { formatCameraSetting } from '../../types/camera';
import type { ExperimentCameraSettings } from '../hooks/useExperimentCameraSettings';

export interface ExperimentCameraSummaryProps {
  camera: ExperimentCameraSettings;
  /** Both an experiment and a phenotyper are chosen. */
  chosen: boolean;
  /** A scan is running: settings can't change now. */
  scanning: boolean;
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
}: ExperimentCameraSummaryProps) {
  const base = 'mt-6 border-t border-gray-200 pt-6 text-sm';
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
    return (
      <p
        className={`${base} font-medium text-amber-800`}
        data-testid="experiment-camera-summary"
      >
        Check the camera settings for{' '}
        {camera.experimentName || 'this experiment'} next to the preview before
        scanning.
      </p>
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
      <button
        type="button"
        onClick={camera.startChange}
        disabled={scanning}
        className="rounded-md border border-gray-300 px-3 py-1 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        Change
      </button>
    </div>
  );
}
