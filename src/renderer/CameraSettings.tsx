/**
 * Camera Settings Page: which one to show (#483).
 */

import { useSearchParams } from 'react-router-dom';
import { ExperimentCameraSettingsPage } from './ExperimentCameraSettingsPage';
import { NoExperimentCameraSettings } from './NoExperimentCameraSettings';
import { StationCameraSettings } from './StationCameraSettings';
import { useCaptureScanChoice } from './hooks/useCaptureScanChoice';

/**
 * Camera Settings (#483): one experiment's settings when opened from Capture Scan's
 * link (?experiment=…&phenotyper=…), or from the sidebar while an experiment and a
 * phenotyper are chosen on Capture Scan. With none chosen, a pointer to Capture Scan.
 * The station's own settings are at ?station=1.
 */
export function CameraSettings() {
  const [params] = useSearchParams();
  const linked = params.get('experiment') && params.get('phenotyper');
  const station = params.get('station') === '1';
  const chosen = useCaptureScanChoice(!linked && !station);
  if (linked) {
    return (
      <ExperimentCameraSettingsPage
        experimentId={params.get('experiment') as string}
        phenotyperId={params.get('phenotyper') as string}
      />
    );
  }
  if (station) return <StationCameraSettings />;
  // Still asking which experiment is chosen: show nothing rather than flash the
  // empty state.
  if (chosen === undefined) return null;
  if (chosen) {
    return (
      <ExperimentCameraSettingsPage
        experimentId={chosen.experimentId}
        phenotyperId={chosen.phenotyperId}
      />
    );
  }
  return <NoExperimentCameraSettings />;
}
