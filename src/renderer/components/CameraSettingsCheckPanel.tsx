/**
 * Set camera settings for <experiment> (#483): shown on Capture Scan before scanning when
 * the experiment has no camera settings, or this phenotyper hasn't checked them today.
 * The values start at the current settings; the live preview follows them, and the
 * settings used before in the experiment can be clicked to fill them in. Confirming
 * unchanged values needs no note; a change does, except for an experiment's first.
 */

import { useEffect, useState } from 'react';
import { CameraSettingsForm } from '../../components/CameraSettingsForm';
import { formatCameraSetting } from '../../types/camera';
import {
  STARTING_CAMERA_VALUES,
  type CameraSettingsChangedToday,
  type CameraSettingsReference,
  type CameraValues,
  type ExperimentCameraSettingsStatus,
} from '../../types/experiment-camera-settings';
import {
  cameraValuesError,
  sameCameraValues,
} from '../../utils/experiment-camera-settings';
import { pathToFileUrl } from '../../utils/file-url';
import { isAbsolutePath } from '../../utils/scan-path';

/** How long the values must stay still before the preview restarts with them. */
export const PREVIEW_DELAY_MS = 500;

export interface CameraSettingsCheckPanelProps {
  experimentName: string;
  status: ExperimentCameraSettingsStatus;
  /** "Used before in this experiment", most recently used first. */
  reference: CameraSettingsReference[];
  /** Where scan images are, for the thumbnails. */
  scansDir: string;
  /** The values to show in the live preview, once they stop changing. */
  onPreview: (values: CameraValues) => void;
  /** Saves; resolves to an error to show, or null once saved. */
  onConfirm: (values: CameraValues, note: string) => Promise<string | null>;
}

function valuesText(v: CameraValues): string {
  return `${formatCameraSetting('exposure_time', v.exposure_time)} µs · gain ${formatCameraSetting(
    'gain',
    v.gain
  )} · gamma ${formatCameraSetting('gamma', v.gamma)}`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "Changed today at 10:15 AM by Ana: 7,300 → 7,400 µs. Roots too dark" */
export function changedTodayText(change: CameraSettingsChangedToday): string {
  const { from, to } = change;
  const parts = from
    ? [
        from.exposure_time !== to.exposure_time &&
          `${formatCameraSetting('exposure_time', from.exposure_time)} → ${formatCameraSetting(
            'exposure_time',
            to.exposure_time
          )} µs`,
        from.gain !== to.gain &&
          `gain ${formatCameraSetting('gain', from.gain)} → ${formatCameraSetting('gain', to.gain)}`,
        from.gamma !== to.gamma &&
          `gamma ${formatCameraSetting('gamma', from.gamma)} → ${formatCameraSetting(
            'gamma',
            to.gamma
          )}`,
      ].filter(Boolean)
    : [`set to ${valuesText(to)}`];
  const who = change.by_name ? ` by ${change.by_name}` : '';
  return `Changed today at ${timeOfDay(change.at)}${who}: ${parts.join(', ')}. ${change.note}`;
}

function scanImageUrl(path: string, scansDir: string): string {
  return pathToFileUrl(isAbsolutePath(path) ? path : `${scansDir}/${path}`);
}

function ReferenceLine({
  line,
  scansDir,
  onPick,
}: {
  line: CameraSettingsReference;
  scansDir: string;
  onPick: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const used =
    line.scan_count === 0 || !line.first_captured || !line.last_captured
      ? 'saved, not used yet'
      : `${line.scan_count} ${line.scan_count === 1 ? 'scan' : 'scans'} · ${shortDate(
          line.first_captured
        )}${
          shortDate(line.first_captured) === shortDate(line.last_captured)
            ? ''
            : ` – ${shortDate(line.last_captured)}`
        }`;
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className="flex w-full items-center gap-3 rounded px-2 py-2 text-left hover:bg-lime-50"
        data-testid="camera-reference-line"
      >
        {line.latest_image_path && !imageFailed ? (
          <img
            src={scanImageUrl(line.latest_image_path, scansDir)}
            alt={`Latest scan at ${valuesText(line)}`}
            className="h-16 w-12 rounded border border-gray-200 object-cover"
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex h-16 w-12 items-center justify-center rounded border border-gray-200 bg-gray-100 text-xs text-gray-400">
            N/A
          </div>
        )}
        <span className="flex-1 text-sm">
          <span className="font-medium text-gray-900">{valuesText(line)}</span>
          {line.is_current && (
            <span className="ml-2 rounded bg-lime-100 px-1.5 py-0.5 text-xs font-medium text-lime-800">
              current
            </span>
          )}
          <span className="block text-xs text-gray-500">{used}</span>
        </span>
      </button>
    </li>
  );
}

export function CameraSettingsCheckPanel({
  experimentName,
  status,
  reference,
  scansDir,
  onPreview,
  onConfirm,
}: CameraSettingsCheckPanelProps) {
  const current = status.current;
  const [values, setValues] = useState<CameraValues>(() =>
    current
      ? {
          exposure_time: current.exposure_time,
          gain: current.gain,
          gamma: current.gamma,
        }
      : STARTING_CAMERA_VALUES
  );
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalid = cameraValuesError(values);
  const changed = current !== null && !sameCameraValues(values, current);
  const noteMissing = changed && note.trim() === '';

  // The preview restarts the camera stream: wait until the values stop changing.
  useEffect(() => {
    if (invalid) return;
    const timer = setTimeout(() => onPreview(values), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [values, invalid, onPreview]);

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      setError(await onConfirm(values, note.trim()));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="mb-6 rounded-lg border-2 border-amber-300 bg-amber-50 p-4"
      aria-labelledby="camera-check-title"
      data-testid="camera-settings-check-panel"
    >
      <h3
        id="camera-check-title"
        className="text-lg font-semibold text-gray-900"
      >
        Set camera settings for {experimentName}
      </h3>
      <p className="mt-1 text-sm text-gray-700">
        {current
          ? 'Check the live preview with a plant in the scanner. If it looks right, confirm. If not, change the settings and say why.'
          : 'This experiment has no camera settings yet. Set them with a plant in the scanner, using the live preview.'}
      </p>

      {status.changedToday && (
        <p
          role="status"
          className="mt-3 rounded border border-amber-400 bg-white px-3 py-2 text-sm font-medium text-amber-900"
          data-testid="camera-changed-today"
        >
          {changedTodayText(status.changedToday)}
        </p>
      )}

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div>
          <CameraSettingsForm
            settings={values}
            onChange={(next) => setValues((prev) => ({ ...prev, ...next }))}
            showActions={false}
          />
          <label className="mt-4 block text-sm font-medium text-gray-700">
            Note{' '}
            <span className="font-normal text-gray-500">
              {current ? '(needed when you change the settings)' : '(optional)'}
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm font-normal"
              placeholder={current ? 'e.g. Roots too dark at 7,300 µs' : ''}
            />
          </label>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-700">
            Used before in this experiment
          </h4>
          {reference.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">
              None yet: this is the experiment&apos;s first setting.
            </p>
          ) : (
            <ul
              className="mt-2 max-h-72 divide-y divide-gray-200 overflow-y-auto rounded border border-gray-200 bg-white"
              aria-label="Camera settings used before in this experiment"
            >
              {reference.map((line) => (
                <ReferenceLine
                  key={`${line.exposure_time}/${line.gain}/${line.gamma}`}
                  line={line}
                  scansDir={scansDir}
                  onPick={() =>
                    setValues({
                      exposure_time: line.exposure_time,
                      gain: line.gain,
                      gamma: line.gamma,
                    })
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {error}
        </p>
      )}
      {noteMissing && !invalid && (
        <p className="mt-3 text-sm text-amber-900">
          You changed the settings: add a note saying why.
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={confirm}
          disabled={!!invalid || noteMissing || saving}
          className="rounded-lg bg-green-600 px-5 py-2 font-semibold text-white shadow hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
        >
          {saving ? 'Saving…' : 'Confirm and continue'}
        </button>
      </div>
    </section>
  );
}
