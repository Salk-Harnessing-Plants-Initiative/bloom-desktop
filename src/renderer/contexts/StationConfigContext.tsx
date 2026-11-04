/**
 * The station's configuration (~/.bloom/.env), asked for once when the app opens and
 * shared by every page (#477). Until it arrives the app shows the start-up loader, so
 * no page opens with it missing. A failed read doesn't hold the app up: pages get no
 * configuration and the error, and Retry reads the file again.
 */

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import type { MachineConfig } from '../../main/config-store';
import type { StationConfigResponse } from '../../types/electron';
import { StartupLoader } from '../components/StartupLoader';

export type StationConfigStatus = 'loading' | 'loaded' | 'failed';

export interface StationConfigValue {
  /** The station's configuration; null until loaded, and when it couldn't be read. */
  config: MachineConfig | null;
  status: StationConfigStatus;
  error: string | null;
  /** Read ~/.bloom/.env again. */
  retry: () => Promise<void>;
  /** Ask for the configuration again, after Machine Configuration saved it. */
  refresh: () => Promise<void>;
}

const StationConfigContext = createContext<StationConfigValue | null>(null);

interface State {
  config: MachineConfig | null;
  status: StationConfigStatus;
  error: string | null;
}

function fromResponse(response: StationConfigResponse): State {
  return response.loadError
    ? { config: null, status: 'failed', error: response.loadError }
    : { config: response.config, status: 'loaded', error: null };
}

function fromFailure(error: unknown): State {
  return {
    config: null,
    status: 'failed',
    error: `Couldn't load this station's settings: ${
      error instanceof Error ? error.message : String(error)
    }`,
  };
}

export function StationConfigProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({
    config: null,
    status: 'loading',
    error: null,
  });

  const ask = useCallback(
    async (request: () => Promise<StationConfigResponse>) => {
      try {
        setState(fromResponse(await request()));
      } catch (error) {
        setState(fromFailure(error));
      }
    },
    []
  );

  useEffect(() => {
    ask(() => window.electron.config.get());
  }, [ask]);

  const retry = useCallback(
    () => ask(() => window.electron.config.reload()),
    [ask]
  );
  const refresh = useCallback(
    () => ask(() => window.electron.config.get()),
    [ask]
  );

  if (state.status === 'loading') return <StartupLoader />;

  return (
    <StationConfigContext.Provider value={{ ...state, retry, refresh }}>
      {children}
    </StationConfigContext.Provider>
  );
}

export function useStationConfig(): StationConfigValue {
  const value = useContext(StationConfigContext);
  if (!value) {
    throw new Error(
      'useStationConfig must be used inside StationConfigProvider'
    );
  }
  return value;
}

/**
 * Refresh for Machine Configuration after a save. Does nothing outside the provider,
 * e.g. when the page is rendered on its own in a test.
 */
export function useRefreshStationConfig(): () => Promise<void> {
  const value = useContext(StationConfigContext);
  return value?.refresh ?? noRefresh;
}

const noRefresh = async (): Promise<void> => undefined;
