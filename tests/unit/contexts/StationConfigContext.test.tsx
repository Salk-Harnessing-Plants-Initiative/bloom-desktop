import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  StationConfigProvider,
  useRefreshStationConfig,
  useStationConfig,
} from '../../../src/renderer/contexts/StationConfigContext';

const get = vi.fn();
const reload = vi.fn();

const loaded = (scanner_name: string) => ({
  config: { scanner_name, scans_dir: '/scans' },
  hasCredentials: false,
  loadError: null,
});

function Probe() {
  const { config, status, error, retry, refresh } = useStationConfig();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="name">{config?.scanner_name ?? 'none'}</p>
      <p data-testid="error">{error ?? ''}</p>
      <button onClick={retry}>retry</button>
      <button onClick={refresh}>refresh</button>
    </div>
  );
}

beforeEach(() => {
  get.mockReset();
  reload.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).electron = { config: { get, reload } };
});

describe('StationConfigProvider (#477)', () => {
  it('shows the start-up loader until the settings arrive, then the pages', async () => {
    let resolve: (value: unknown) => void = () => {};
    get.mockReturnValue(new Promise((r) => (resolve = r)));
    render(
      <StationConfigProvider>
        <Probe />
      </StationConfigProvider>
    );
    expect(screen.getByTestId('startup-loader')).toHaveTextContent(
      "Loading this station's settings…"
    );
    expect(screen.queryByTestId('status')).not.toBeInTheDocument();

    await act(async () => resolve(loaded('PBIOBScanner')));
    expect(screen.queryByTestId('startup-loader')).not.toBeInTheDocument();
    expect(screen.getByTestId('status')).toHaveTextContent('loaded');
    expect(screen.getByTestId('name')).toHaveTextContent('PBIOBScanner');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("opens the app with no settings and the reason when the file couldn't be read", async () => {
    get.mockResolvedValue({
      ...loaded(''),
      loadError: "Couldn't read this station's settings: EACCES",
    });
    render(
      <StationConfigProvider>
        <Probe />
      </StationConfigProvider>
    );
    expect(await screen.findByTestId('status')).toHaveTextContent('failed');
    expect(screen.getByTestId('name')).toHaveTextContent('none');
    expect(screen.getByTestId('error')).toHaveTextContent('EACCES');
  });

  it('opens the app with the reason when asking fails', async () => {
    get.mockRejectedValue(new Error('IPC gone'));
    render(
      <StationConfigProvider>
        <Probe />
      </StationConfigProvider>
    );
    expect(await screen.findByTestId('error')).toHaveTextContent(
      "Couldn't load this station's settings: IPC gone"
    );
  });

  it('reads the file again on Retry', async () => {
    get.mockResolvedValue({ ...loaded(''), loadError: 'EACCES' });
    reload.mockResolvedValue(loaded('PBIOBScanner'));
    render(
      <StationConfigProvider>
        <Probe />
      </StationConfigProvider>
    );
    await screen.findByText('failed');
    await act(async () => {
      fireEvent.click(screen.getByText('retry'));
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('status')).toHaveTextContent('loaded');
    expect(screen.getByTestId('name')).toHaveTextContent('PBIOBScanner');
  });

  it('keeps the pages on screen while a refresh is under way', async () => {
    let resolveRefresh: (value: unknown) => void = () => {};
    get
      .mockResolvedValueOnce(loaded('SlowScanner'))
      .mockReturnValueOnce(new Promise((r) => (resolveRefresh = r)));
    render(
      <StationConfigProvider>
        <Probe />
      </StationConfigProvider>
    );
    await screen.findByText('SlowScanner');

    act(() => {
      fireEvent.click(screen.getByText('refresh'));
    });
    // Still waiting: the page stays, with what it had, and no loader.
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('startup-loader')).not.toBeInTheDocument();
    expect(screen.getByTestId('name')).toHaveTextContent('SlowScanner');

    await act(async () => resolveRefresh(loaded('PBIOBScanner')));
    expect(screen.getByTestId('name')).toHaveTextContent('PBIOBScanner');
  });
});

describe('useRefreshStationConfig', () => {
  it('does nothing outside the provider', async () => {
    let refresh: () => Promise<void> = async () => {};
    function Page() {
      refresh = useRefreshStationConfig();
      return null;
    }
    render(<Page />);
    await expect(refresh()).resolves.toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });
});
