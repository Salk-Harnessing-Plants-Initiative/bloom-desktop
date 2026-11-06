/**
 * Capture Scan's line about the selected experiment's camera settings (#483): what
 * scans will use, who set them and when they were checked, with Edit; or why
 * scanning waits.
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

/** "Nov 3" */
function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * "set by Ana Lopez (Nov 3)". Settings copied from earlier scans when the app was
 * updated have no phenotyper, and their date is the update's, so neither is shown.
 */
export function setByText(setByName: string | null, createdAt: string): string {
  return setByName
    ? `set by ${setByName} (${dayOf(createdAt)})`
    : 'set from earlier scans';
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
  const linkClass = 'font-medium text-lime-700 underline hover:text-lime-800';
  if (camera.needsCheck) {
    // The experiment has none yet: add them. They exist, but this phenotyper hasn't
    // checked them today: verify them.
    if (camera.status?.current == null) {
      return (
        <div className={base} data-testid="experiment-camera-summary">
          <p className="text-amber-800">
            <span aria-hidden="true">⚠ </span>Camera settings not configured
          </p>
          <Link
            to={settingsLink}
            className="mt-2 inline-block rounded-md bg-lime-700 px-3 py-1.5 font-medium text-white hover:bg-lime-800"
          >
            Add camera settings →
          </Link>
        </div>
      );
    }
    return (
      <p
        className={`${base} text-amber-800`}
        data-testid="experiment-camera-summary"
      >
        <span aria-hidden="true">⚠ </span>
        Camera not verified today ·{' '}
        <Link to={settingsLink} className={linkClass}>
          Verify
        </Link>
      </p>
    );
  }
  const values = camera.checkedValues;
  const current = camera.status?.current;
  if (!values || !current) return null;
  const checked = [
    'Checked today',
    checkedAt(current.last_confirmed_at),
    current.last_confirmed_by_name && `by ${current.last_confirmed_by_name}`,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <p
      className={`${base} text-gray-700`}
      data-testid="experiment-camera-summary"
      title={checked}
    >
      <span className="text-green-700" aria-hidden="true">
        ✓{' '}
      </span>
      Camera {setByText(current.set_by_name, current.created_at)}:{' '}
      {formatCameraSetting('exposure_time', values.exposure_time)} µs · Gain{' '}
      {formatCameraSetting('gain', values.gain)} · Gamma{' '}
      {formatCameraSetting('gamma', values.gamma)}
      {scanning ? null : (
        <>
          {' · '}
          <Link to={settingsLink} className={linkClass}>
            Edit
          </Link>
        </>
      )}
    </p>
  );
}
