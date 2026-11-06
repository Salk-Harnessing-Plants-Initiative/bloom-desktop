/**
 * Set camera settings for <experiment> (#483), on Camera Settings: when the experiment
 * has no camera settings, this phenotyper hasn't checked them today, or to edit them.
 * The values start at the current settings; the live preview follows them, and the
 * previous camera settings used in the experiment can be applied with one click. Confirming
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
  /** "Previous camera settings used in this experiment", most recently used first. */
  reference: CameraSettingsReference[];
  /** Where scan images are, for the thumbnails. */
  scansDir: string;
  /** The values to show in the live preview, once they stop changing. */
  onPreview: (values: CameraValues) => void;
  /** Saves; resolves to an error to show, or null once saved. */
  onConfirm: (values: CameraValues, note: string) => Promise<string | null>;
  /** The confirm button's text. */
  confirmLabel?: string;
  /** Show the "Set camera settings for …" heading (a page may have its own). */
  showTitle?: boolean;
  /** One column (fields, note, then the previous settings), for a narrow space beside a preview. */
  stacked?: boolean;
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
  confirmLabel = 'Save settings',
  showTitle = true,
  stacked = false,
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

  const changed = current !== null && !sameCameraValues(values, current);
  // New settings take one decimal of gamma; the current ones can be confirmed as
  // they are (e.g. 1.05 from scans taken before that rule).
  const invalid = cameraValuesError(values, {
    oneDecimalGamma: current === null || changed,
  });
  // The form shows its own range errors under each field; these rules it doesn't know.
  const ruleError =
    invalid && Object.keys(cameraSettingsErrors(values)).length === 0
      ? invalid
      : null;
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
      className={`mb-6 rounded-lg border-2 p-4 ${
        current ? 'border-gray-200 bg-white' : 'border-amber-300 bg-amber-50'
      }`}
      aria-label={`Set camera settings for ${experimentName}`}
      data-testid="camera-settings-check-panel"
    >
      {showTitle && (
        <h3 className="text-lg font-semibold text-gray-900">
          Set camera settings for {experimentName}
        </h3>
      )}

      {status.changedToday && (
        <p
          role="status"
          className="mt-3 rounded border border-amber-400 bg-white px-3 py-2 text-sm font-medium text-amber-900"
          data-testid="camera-changed-today"
        >
          {changedTodayText(status.changedToday)}
        </p>
      )}

      <div className={`mt-4 grid gap-6 ${stacked ? '' : 'lg:grid-cols-2'}`}>
        <div>
          <CameraSettingsForm
            settings={values}
            onChange={change}
            showActions={false}
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            aria-label="Note"
            className="mt-4 w-full rounded border border-gray-300 px-2 py-1 text-sm"
            placeholder={
              current
                ? 'Note, needed if you change them, e.g. Roots too dark at 7,300 µs'
                : 'Optional note…'
            }
          />
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-700">
            Previous camera settings used in this experiment
          </h4>
          {reference.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">
              None yet: this is the experiment&apos;s first setting.
            </p>
          ) : (
            <ul
              className="mt-2 max-h-72 divide-y divide-gray-200 overflow-y-auto rounded border border-gray-200 bg-white"
              aria-label="Previous camera settings used in this experiment"
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
          {saving ? 'Saving…' : confirmLabel}
        </button>
      </div>
    </section>
  );
}
