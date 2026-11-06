import { useEffect, useState } from 'react';

/** The station's scans folder from Machine Configuration, for scan thumbnails; '' until loaded. */
export function useStationScansDir(): string {
  const [scansDir, setScansDir] = useState('');
  useEffect(() => {
    let cancelled = false;
    window.electron.config
      .get()
      .then(({ config }) => {
        if (!cancelled) setScansDir(config.scans_dir ?? '');
      })
      .catch((error: unknown) => {
        // No thumbnails without it; the list still shows the settings.
        console.error(
          '[CameraSettings] Could not read the scans folder:',
          error instanceof Error ? error.message : 'Unknown error'
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return scansDir;
}
