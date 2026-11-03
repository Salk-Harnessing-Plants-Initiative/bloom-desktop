/**
 * Machine Configuration and the station settings kept at start-up (#477, #485):
 * a save reaches the other pages, and while the settings file can't be read the
 * page shows why and won't save.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { MachineConfiguration } from '../../../src/renderer/MachineConfiguration';
import {
  StationConfigProvider,
  useStationConfig,
} from '../../../src/renderer/contexts/StationConfigContext';

const stored = (scanner_name: string) => ({
  config: {
    scanner_mode: 'cylinderscan',
    scanner_name,
    camera_ip_address: 'mock',
    scans_dir: '/scans',
    bloom_api_url: 'https://bloom.example.org/api',
    bloom_scanner_username: '',
    bloom_scanner_password: '',
    bloom_anon_key: '',
    num_frames: 72,
    seconds_per_rot: 7,
  },
  hasCredentials: false,
  loadError: null as string | null,
});

const config = {
  get: vi.fn(),
  reload: vi.fn(),
  set: vi.fn(),
  testCamera: vi.fn(),
  browseDirectory: vi.fn(),
  exists: vi.fn(),
  fetchScanners: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electron: unknown }).electron = {
    config,
    camera: {
      detectCameras: vi.fn().mockResolvedValue({ success: true, cameras: [] }),
    },
    python: {
      checkHardware: vi.fn().mockResolvedValue({}),
      restart: vi.fn().mockResolvedValue({ success: true }),
    },
  };
  config.set.mockResolvedValue({ success: true });
  config.exists.mockResolvedValue(true);
});

/** What the rest of the app sees: Capture Scan's copy of the scanner name. */
function OtherPage() {
  const { config: station } = useStationConfig();
  return <p data-testid="other-page-scanner">{station?.scanner_name}</p>;
}

describe('Machine Configuration and the kept station settings', () => {
  it('refreshes the copy the other pages use after a save', async () => {
    config.get
      .mockResolvedValueOnce(stored('SlowScanner')) // the provider, at app start
      .mockResolvedValueOnce(stored('SlowScanner')) // the page's form
      .mockResolvedValue(stored('PBIOBScanner')); // after the save
    render(
      <StationConfigProvider>
        <MachineConfiguration />
        <OtherPage />
      </StationConfigProvider>
    );
    expect(await screen.findByTestId('other-page-scanner')).toHaveTextContent(
      'SlowScanner'
    );

    await act(async () => {
      fireEvent.click(await screen.findByText('Save Configuration'));
    });

    expect(config.set).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByTestId('other-page-scanner')).toHaveTextContent(
        'PBIOBScanner'
      )
    );
  });

  it("won't save while the settings file can't be read, and Retry turns saving back on", async () => {
    config.get.mockResolvedValue({
      ...stored(''),
      loadError:
        "Couldn't read this station's settings file (/home/x/.bloom/.env): EBUSY",
    });
    config.reload.mockResolvedValue(stored('PBIOBScanner'));
    render(<MachineConfiguration />);

    expect(await screen.findByText(/saving is off/)).toBeInTheDocument();
    expect(screen.getByText(/EBUSY/)).toBeInTheDocument();
    expect(screen.getByText('Save Configuration')).toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });
    expect(config.reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/saving is off/)).not.toBeInTheDocument();
    expect(screen.getByText('Save Configuration')).toBeEnabled();
  });
});
