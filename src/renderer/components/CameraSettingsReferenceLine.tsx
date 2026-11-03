/**
 * The text and the "Used before in this experiment" lines of the Set camera settings
 * panel (#483).
 */

import { useState } from 'react';
import { formatCameraSetting } from '../../types/camera';
import type {
  CameraSettingsChangedToday,
  CameraSettingsReference,
  CameraValues,
} from '../../types/experiment-camera-settings';
import { roundGamma } from '../../utils/experiment-camera-settings';
import { pathToFileUrl } from '../../utils/file-url';
import { isAbsolutePath } from '../../utils/scan-path';

export function valuesText(v: CameraValues): string {
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
        roundGamma(from.gamma) !== roundGamma(to.gamma) &&
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

export function ReferenceLine({
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
