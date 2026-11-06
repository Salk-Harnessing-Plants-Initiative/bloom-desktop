/**
 * The selected experiment's camera settings on Capture Scan (#483). Once an experiment
 * and a phenotyper are chosen, it loads whether this phenotyper has checked the
 * settings today, and the previous camera settings used in the experiment. The check itself is
 * on Camera Settings; scans use the experiment's settings only once they're checked.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CameraSettingsReference,
  CameraValues,
  ExperimentCameraSettingsStatus,
} from '../../types/experiment-camera-settings';

export interface ExperimentCameraSettings {
  /** The experiment's name, for the panel and the summary. */
  experimentName: string;
  status: ExperimentCameraSettingsStatus | null;
  reference: CameraSettingsReference[];
  loading: boolean;
  /** Why the settings couldn't be loaded. */
  loadError: string | null;
  /** True when a check is needed: no settings yet, or not checked today by this phenotyper. */
  needsCheck: boolean;
  /** The checked settings scans use; null until there are some. */
  checkedValues: CameraValues | null;
  /** Save settings; resolves to an error to show, or null. */
  confirm: (values: CameraValues, note: string) => Promise<string | null>;
  reload: () => void;
}

function cameraValues(v: CameraValues): CameraValues {
  return { exposure_time: v.exposure_time, gain: v.gain, gamma: v.gamma };
}

export function useExperimentCameraSettings(
  experimentId: string,
  phenotyperId: string
): ExperimentCameraSettings {
  const [experimentName, setExperimentName] = useState('');
  const [status, setStatus] = useState<ExperimentCameraSettingsStatus | null>(
    null
  );
  const [reference, setReference] = useState<CameraSettingsReference[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadCount, setLoadCount] = useState(0);

  const experiment = experimentId.trim();
  const phenotyper = phenotyperId.trim();

  // A new experiment or phenotyper starts empty; a reload keeps what's shown meanwhile.
  const loadedFor = useRef('');
  useEffect(() => {
    const key = `${experiment}\n${phenotyper}`;
    if (key !== loadedFor.current) {
      loadedFor.current = key;
      setStatus(null);
      setReference([]);
    }
    setLoadError(null);
    if (!experiment || !phenotyper) {
      setExperimentName('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    const api = window.electron.database.experimentCameraSettings;
    Promise.all([
      api.status(experiment, phenotyper),
      api.reference(experiment),
      window.electron.database.experiments.get(experiment),
    ])
      .then(([statusResult, referenceResult, experimentResult]) => {
        if (cancelled) return;
        setExperimentName(experimentResult?.data?.name ?? '');
        if (!statusResult.success || !statusResult.data) {
          setLoadError(statusResult.error ?? 'Unknown error');
          return;
        }
        setStatus(statusResult.data);
        // Without the list the panel still works: it's a reference only.
        setReference(
          referenceResult.success && referenceResult.data
            ? referenceResult.data
            : []
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Unknown error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [experiment, phenotyper, loadCount]);

  const reload = useCallback(() => setLoadCount((n) => n + 1), []);

  const confirm = useCallback(
    async (values: CameraValues, note: string): Promise<string | null> => {
      const result =
        await window.electron.database.experimentCameraSettings.confirm({
          experimentId: experiment,
          phenotyperId: phenotyper,
          currentSettingsId: status?.current?.id ?? null,
          ...cameraValues(values),
          note,
        });
      if (!result.success || !result.data) {
        // Someone else saved settings meanwhile: show them, with the reason.
        reload();
        return result.error ?? 'Unknown error';
      }
      setStatus(result.data);
      reload();
      return null;
    },
    [experiment, phenotyper, status, reload]
  );

  const current = status?.current ?? null;
  const confirmedToday = status?.confirmedToday ?? false;
  return {
    experimentName,
    status,
    reference,
    loading,
    loadError,
    needsCheck: status !== null && (current === null || !confirmedToday),
    checkedValues:
      current !== null && confirmedToday ? cameraValues(current) : null,
    confirm,
    reload,
  };
}
