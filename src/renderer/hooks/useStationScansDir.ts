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
      .catch(() => {
        // No thumbnails without it; the list still shows the settings.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return scansDir;
}
