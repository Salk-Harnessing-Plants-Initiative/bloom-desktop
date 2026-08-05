import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ScannerStatusPanel } from '../../../src/renderer/components/graviscan/ScannerStatusPanel';
import type { ScannerPanelState } from '../../../src/types/graviscan';

function scanner(overrides: Partial<ScannerPanelState> = {}): ScannerPanelState {
  return {
    scannerId: 'sc-1',
    name: 'Scanner 1',
    enabled: true,
    isOnline: true,
    isBusy: false,
    state: 'idle',
    progress: 0,
    outputFilename: '',
    gridMode: '2grid',
    connectionStatus: 'ready',
    ...overrides,
  };
}

describe('ScannerStatusPanel', () => {
  it('renders each scanner name, connection status, and grid mode', () => {
    render(
      <ScannerStatusPanel
        scanners={[scanner({ scannerId: 'sc-1', name: 'Scanner 1' }), scanner({ scannerId: 'sc-2', name: 'Scanner 2', gridMode: '4grid' })]}
        progressByScanner={{}}
        isScanning={false}
      />
    );

    expect(screen.getByText('Scanner 1')).toBeInTheDocument();
    expect(screen.getByText('Scanner 2')).toBeInTheDocument();
    expect(screen.getByText(/4grid/)).toBeInTheDocument();
  });

  it('marks an offline scanner distinctly from an online one', () => {
    render(
      <ScannerStatusPanel
        scanners={[
          scanner({ scannerId: 'sc-1', isOnline: true, connectionStatus: 'ready' }),
          scanner({ scannerId: 'sc-2', isOnline: false, connectionStatus: 'error', lastError: 'wedged' }),
        ]}
        progressByScanner={{}}
        isScanning={false}
      />
    );

    const online = screen.getByTestId('scanner-status-sc-1');
    const offline = screen.getByTestId('scanner-status-sc-2');
    expect(online.textContent).toMatch(/ready/i);
    expect(offline.textContent).toMatch(/error/i);
    expect(offline.textContent).toMatch(/wedged/);
  });

  it('shows live progress from useScanSession while scanning', () => {
    render(
      <ScannerStatusPanel
        scanners={[scanner({ scannerId: 'sc-1' })]}
        progressByScanner={{ 'sc-1': 50 }}
        isScanning={true}
      />
    );

    expect(screen.getByTestId('scanner-status-sc-1').textContent).toMatch(/50%/);
  });

  it('shows 0% progress for a scanner with no recorded progress yet while scanning', () => {
    render(
      <ScannerStatusPanel
        scanners={[scanner({ scannerId: 'sc-1' })]}
        progressByScanner={{}}
        isScanning={true}
      />
    );
    expect(screen.getByTestId('scanner-status-sc-1').textContent).toMatch(/0%/);
  });

  it('does not show a progress percentage when no scan is active', () => {
    render(
      <ScannerStatusPanel
        scanners={[scanner({ scannerId: 'sc-1' })]}
        progressByScanner={{}}
        isScanning={false}
      />
    );
    expect(screen.getByTestId('scanner-status-sc-1').textContent).not.toMatch(/%/);
  });
});
