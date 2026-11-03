/**
 * Set camera settings for <experiment> (#483): shown on Capture Scan before scanning when
 * the experiment has no camera settings, or this phenotyper hasn't checked them today.
 * The values start at the current settings; the live preview follows them, and the
 * settings used before in the experiment can be clicked to fill them in. Confirming
 * unchanged values needs no note; a change does, except for an experiment's first.
 */

import { useEffect, useRef, useState } from 'react';
import { CameraSettingsForm } from '../../components/CameraSettingsForm';
import { cameraSettingsErrors } from '../../types/camera';
import { ReferenceLine, changedTodayText } from './CameraSettingsReferenceLine';
import {
  STARTING_CAMERA_VALUES,
  type CameraSettingsReference,
  type CameraValues,
  type ExperimentCameraSettingsStatus,
} from '../../types/experiment-camera-settings';
import {
  cameraValuesError,
  sameCameraValues,
} from '../../utils/experiment-camera-settings';

export { changedTodayText } from './CameraSettingsReferenceLine';

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

/** Only the three settings the panel keeps (the form also passes the camera IP). */
function cameraValues(v: CameraValues): CameraValues {
  return { exposure_time: v.exposure_time, gain: v.gain, gamma: v.gamma };
}

function startingValues(
  current: ExperimentCameraSettingsStatus['current']
): CameraValues {
  return current ? cameraValues(current) : STARTING_CAMERA_VALUES;
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
    startingValues(current)
  );
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The settings changed underneath (e.g. "were just changed, check them again"):
  // start again from the new ones. An error saying why stays.
  const shownSettingsId = useRef(current?.id ?? null);
  useEffect(() => {
    const id = current?.id ?? null;
    if (id === shownSettingsId.current) return;
    shownSettingsId.current = id;
    setValues(startingValues(current));
    setNote('');
  }, [current]);

  /** New values from the form or the list; an earlier error no longer applies. */
  const change = (next: Partial<CameraValues>) => {
    setValues((prev) => cameraValues({ ...prev, ...next }));
    setError(null);
  };

  const invalid = cameraValuesError(values);
  // The form shows its own range errors under each field; these rules it doesn't know.
  const ruleError =
    invalid && Object.keys(cameraSettingsErrors(values)).length === 0
      ? invalid
      : null;
  const changed = current !== null && !sameCameraValues(values, current);
  const noteMissing = changed && note.trim() === '';

  // The preview restarts the camera stream: wait until the values stop changing. Only
  // the values restart the wait, not a new onPreview from a parent's re-render.
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;
  useEffect(() => {
    if (invalid) return;
    const timer = setTimeout(
      () => onPreviewRef.current(values),
      PREVIEW_DELAY_MS
    );
    return () => clearTimeout(timer);
  }, [values, invalid]);

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      setError(await onConfirm(values, note.trim()));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unknown error');
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
            onChange={change}
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
                  onPick={() => change(line)}
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
      {ruleError && (
        <p
          className="mt-3 text-sm font-medium text-red-600"
          data-testid="camera-values-error"
        >
          {ruleError}
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
