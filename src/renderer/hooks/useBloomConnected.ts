import { useEffect, useState } from 'react';
import { isBloomConnected } from '../../utils/bloom-connection';

/**
 * Whether this computer uses Bloom, from the machine config. Connected until the
 * config says otherwise, or if it can't be read: the main process refuses uploads
 * either way.
 */
export function useBloomConnected(): boolean {
  const [connected, setConnected] = useState(true);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { config } = await window.electron.config.get();
        if (mounted) setConnected(isBloomConnected(config));
      } catch {
        // Keep connected
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  return connected;
}
