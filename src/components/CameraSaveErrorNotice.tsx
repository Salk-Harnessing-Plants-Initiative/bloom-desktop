/**
 * Why applied camera settings couldn't be kept for future sessions (#440), and the
 * list of save error codes, both shown on Camera Settings.
 */

import {
  CAMERA_SETTINGS_SAVE_ERRORS,
  type CameraSettingsWithSource,
} from '../types/camera';

type SaveError = NonNullable<CameraSettingsWithSource['saveError']>;

/** The failed save: its code, what it means, what to do, and the raw message. */
export function CameraSaveErrorNotice({ error }: { error: SaveError }) {
  const { title, help } = CAMERA_SETTINGS_SAVE_ERRORS[error.code];
  return (
    <div
      role="alert"
      className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <p className="font-medium">
        Applied to the camera, but not saved for future sessions.
      </p>
      <p className="mt-1">
        <span className="font-mono font-semibold">{error.code}</span>: {title}.{' '}
        {help}
      </p>
      <p className="mt-1 text-xs text-amber-800">Details: {error.message}</p>
    </div>
  );
}

/** Every save error code, folded away until the operator opens it. */
export function CameraSaveErrorCodes() {
  return (
    <details className="mt-3 text-xs text-gray-600">
      <summary className="cursor-pointer">
        What do the save error codes mean?
      </summary>
      <dl className="mt-2 space-y-1">
        {Object.entries(CAMERA_SETTINGS_SAVE_ERRORS).map(
          ([code, { title, help }]) => (
            <div key={code}>
              <dt className="inline font-mono font-semibold">{code}</dt>
              <dd className="inline">
                {' '}
                {title}. {help}
              </dd>
            </div>
          )
        )}
      </dl>
    </details>
  );
}
