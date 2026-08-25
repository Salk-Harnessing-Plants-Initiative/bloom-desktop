import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { ScanControlSection } from '../../../src/renderer/components/graviscan/ScanControlSection';
import type { UseScanSessionResult } from '../../../src/renderer/hooks/useScanSession';
import type { UseContinuousModeResult } from '../../../src/renderer/hooks/useContinuousMode';
import type { UseTestScanResult } from '../../../src/renderer/hooks/useTestScan';

function scanSession(
  overrides: Partial<UseScanSessionResult> = {}
): UseScanSessionResult {
  return {
    isScanning: false,
    pendingJobs: {},
    progressByScanner: {},
    currentCycle: 0,
    totalCycles: 0,
    coordinatorState: 'idle',
    verificationStatus: 'idle',
    verificationResults: {},
    error: null,
    scanStartedAt: null,
    nextScanAt: null,
    abnormalTermination: null,
    canStartScan: true,
    startScan: vi.fn().mockResolvedValue(undefined),
    cancelScan: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function continuousMode(
  overrides: Partial<UseContinuousModeResult> = {}
): UseContinuousModeResult {
  return {
    isContinuous: false,
    setIsContinuous: vi.fn(),
    intervalMinutes: 5,
    setIntervalMinutes: vi.fn(),
    durationMinutes: 60,
    setDurationMinutes: vi.fn(),
    validate: vi.fn().mockReturnValue(null),
    cadenceContext: {
      platesPerScanner: 2,
      scannerCount: 1,
      dpi: 1200,
      regionMm: { width: 140, height: 140 },
    },
    ...overrides,
  };
}

function testScan(
  overrides: Partial<UseTestScanResult> = {}
): UseTestScanResult {
  return {
    isTesting: false,
    testResults: {},
    error: null,
    testAllScanners: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    scanSession: scanSession(),
    continuousMode: continuousMode(),
    testScan: testScan(),
    waveMissingMetadata: false,
    anyPlateFilled: true,
    ...overrides,
  };
}

describe('ScanControlSection', () => {
  let overtimeListeners: Array<(data: unknown) => void>;

  beforeEach(() => {
    overtimeListeners = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = global.window as any;
    win.electron.gravi = {
      ...win.electron.gravi,
      onOvertime: vi.fn((cb: (data: unknown) => void) => {
        overtimeListeners.push(cb);
        return () => {};
      }),
    };
  });

  function fireOvertime(data: unknown) {
    act(() => {
      overtimeListeners.forEach((cb) => cb(data));
    });
  }

  it('Start button calls scanSession.startScan', async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <ScanControlSection
        {...baseProps({ scanSession: scanSession({ startScan: start }) })}
      />
    );

    await user.click(screen.getByRole('button', { name: /^start scan$/i }));
    expect(start).toHaveBeenCalled();
  });

  it('Start button is disabled while WedgeContext (surfaced via canStartScan) reports an active wedge', () => {
    render(
      <ScanControlSection
        {...baseProps({ scanSession: scanSession({ canStartScan: false }) })}
      />
    );
    expect(
      screen.getByRole('button', { name: /^start scan$/i })
    ).toBeDisabled();
  });

  it('Cancel button calls scanSession.cancelScan and is disabled while a cancel is in flight', async () => {
    let resolveCancel!: () => void;
    const cancel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCancel = resolve;
        })
    );
    const user = userEvent.setup();
    render(
      <ScanControlSection
        {...baseProps({
          scanSession: scanSession({ isScanning: true, cancelScan: cancel }),
        })}
      />
    );

    const cancelButton = screen.getByRole('button', { name: /^cancel$/i });
    await user.click(cancelButton);
    expect(cancel).toHaveBeenCalled();
    expect(cancelButton).toBeDisabled();

    await act(async () => {
      resolveCancel();
    });
  });

  it('renders the scanSession error banner (covers the Cancel-rejection error from task 12.1)', () => {
    render(
      <ScanControlSection
        {...baseProps({
          scanSession: scanSession({ error: 'IPC channel closed' }),
        })}
      />
    );
    expect(screen.getByText(/IPC channel closed/)).toBeInTheDocument();
  });

  it('renders the zero-interval validation error from useContinuousMode.validate()', () => {
    render(
      <ScanControlSection
        {...baseProps({
          continuousMode: continuousMode({
            isContinuous: true,
            validate: vi
              .fn()
              .mockReturnValue(
                'Interval must be a positive number of minutes.'
              ),
          }),
        })}
      />
    );
    expect(
      screen.getByText(/Interval must be a positive number of minutes\./)
    ).toBeInTheDocument();
  });

  it('disables "Start Scan" while the interval-validation error is showing (regression: error was displayed but did not block starting, review-pr round 5)', () => {
    render(
      <ScanControlSection
        {...baseProps({
          continuousMode: continuousMode({
            isContinuous: true,
            validate: vi
              .fn()
              .mockReturnValue(
                'Interval must be a positive number of minutes.'
              ),
          }),
        })}
      />
    );
    expect(
      screen.getByRole('button', { name: /^start scan$/i })
    ).toBeDisabled();
  });

  it('renders the overtime banner when the coordinator fires an overtime event', () => {
    render(
      <ScanControlSection
        {...baseProps({
          scanSession: scanSession({ isScanning: true, currentCycle: 3 }),
        })}
      />
    );
    expect(screen.queryByTestId('overtime-banner')).not.toBeInTheDocument();

    fireOvertime({ overtimeMs: 65000 });
    expect(screen.getByTestId('overtime-banner')).toBeInTheDocument();
    expect(screen.getByTestId('overtime-banner').textContent).toMatch(/1m/);
  });

  it('shows a non-blocking pre-start warning when the wave has no linked metadata and no plate has been manually filled', () => {
    render(
      <ScanControlSection
        {...baseProps({ waveMissingMetadata: true, anyPlateFilled: false })}
      />
    );
    expect(
      screen.getByText(/no plates have been (filled|assigned)/i)
    ).toBeInTheDocument();
    // Non-blocking: Start remains enabled by this warning alone.
    expect(
      screen.getByRole('button', { name: /^start scan$/i })
    ).not.toBeDisabled();
  });

  it('does not show the pre-start warning once at least one plate has been filled in', () => {
    render(
      <ScanControlSection
        {...baseProps({ waveMissingMetadata: true, anyPlateFilled: true })}
      />
    );
    expect(
      screen.queryByText(/no plates have been (filled|assigned)/i)
    ).not.toBeInTheDocument();
  });

  it('renders the abnormal-termination banner with the expected cycle count', () => {
    render(
      <ScanControlSection
        {...baseProps({
          scanSession: scanSession({
            abnormalTermination: { expectedCycles: 6 },
          }),
        })}
      />
    );
    expect(screen.getByText(/6/)).toBeInTheDocument();
    expect(
      screen.getByText(/did not finish|never finished|incomplete/i)
    ).toBeInTheDocument();
  });

  it('shows a "Cycle X of Y" indicator while a multi-cycle continuous scan is running (regression: cycle-boundary progress reset had no explanation)', () => {
    render(
      <ScanControlSection
        {...baseProps({
          scanSession: scanSession({
            isScanning: true,
            currentCycle: 2,
            totalCycles: 3,
          }),
        })}
      />
    );
    expect(screen.getByText(/cycle 2 of 3/i)).toBeInTheDocument();
  });

  it('does not show a cycle-count indicator for a single-cycle (non-continuous) session', () => {
    render(
      <ScanControlSection
        {...baseProps({
          scanSession: scanSession({
            isScanning: true,
            currentCycle: 1,
            totalCycles: 1,
          }),
        })}
      />
    );
    expect(screen.queryByText(/cycle 1 of 1/i)).not.toBeInTheDocument();
  });

  it('shows a waiting-for-next-cycle indicator when coordinatorState is "waiting"', () => {
    render(
      <ScanControlSection
        {...baseProps({
          scanSession: scanSession({
            isScanning: true,
            coordinatorState: 'waiting',
          }),
        })}
      />
    );
    expect(screen.getByText(/waiting for next cycle/i)).toBeInTheDocument();
  });

  it('does not show the waiting-for-next-cycle indicator while actively scanning', () => {
    render(
      <ScanControlSection
        {...baseProps({
          scanSession: scanSession({
            isScanning: true,
            coordinatorState: 'scanning',
          }),
        })}
      />
    );
    expect(
      screen.queryByText(/waiting for next cycle/i)
    ).not.toBeInTheDocument();
  });

  it('does not show the waiting-for-next-cycle indicator when isScanning is false, even if coordinatorState is stale "waiting" (regression: no isScanning gate, review-pr round 5)', () => {
    render(
      <ScanControlSection
        {...baseProps({
          scanSession: scanSession({
            isScanning: false,
            coordinatorState: 'waiting',
          }),
        })}
      />
    );
    expect(
      screen.queryByText(/waiting for next cycle/i)
    ).not.toBeInTheDocument();
  });

  it('Test Scan button invokes useTestScan.testAllScanners', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <ScanControlSection
        {...baseProps({ testScan: testScan({ testAllScanners: run }) })}
      />
    );

    await user.click(screen.getByRole('button', { name: /test scan/i }));
    expect(run).toHaveBeenCalled();
  });

  it('disables "Test Scan" while a real scan session is in progress (regression: only gated on its own isTesting, not scanSession.isScanning, review-pr round 5)', () => {
    render(
      <ScanControlSection
        {...baseProps({
          scanSession: scanSession({ isScanning: true }),
        })}
      />
    );
    expect(screen.getByRole('button', { name: /test scan/i })).toBeDisabled();
  });

  it("renders useTestScan's blocking output-dir-failure error", () => {
    render(
      <ScanControlSection
        {...baseProps({
          testScan: testScan({
            error: 'Could not determine the scan output directory.',
          }),
        })}
      />
    );
    expect(
      screen.getByText(/Could not determine the scan output directory\./)
    ).toBeInTheDocument();
  });

  it('the continuous-scan checkbox toggles continuousMode.setIsContinuous', async () => {
    const setIsContinuous = vi.fn();
    const user = userEvent.setup();
    render(
      <ScanControlSection
        {...baseProps({ continuousMode: continuousMode({ setIsContinuous }) })}
      />
    );

    await user.click(
      screen.getByRole('checkbox', { name: /continuous scan/i })
    );
    expect(setIsContinuous).toHaveBeenCalledWith(true);
  });

  it('interval/duration inputs only render once continuous mode is on, and edits call their setters', async () => {
    const setIntervalMinutes = vi.fn();
    const setDurationMinutes = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <ScanControlSection
        {...baseProps({
          continuousMode: continuousMode({ isContinuous: false }),
        })}
      />
    );
    expect(screen.queryByLabelText(/interval/i)).not.toBeInTheDocument();

    rerender(
      <ScanControlSection
        {...baseProps({
          continuousMode: continuousMode({
            isContinuous: true,
            setIntervalMinutes,
            setDurationMinutes,
          }),
        })}
      />
    );

    const intervalInput = screen.getByLabelText(/interval/i);
    await user.clear(intervalInput);
    await user.type(intervalInput, '9');
    expect(setIntervalMinutes).toHaveBeenCalled();

    const durationInput = screen.getByLabelText(/duration/i);
    await user.clear(durationInput);
    await user.type(durationInput, '120');
    expect(setDurationMinutes).toHaveBeenCalled();
  });

  it("labels Duration in minutes, matching the Interval field's unit and the production rig's convention (regression: mismatched hours/minutes units confused a live tester)", () => {
    render(
      <ScanControlSection
        {...baseProps({
          continuousMode: continuousMode({ isContinuous: true }),
        })}
      />
    );
    expect(screen.getByLabelText(/duration.*minutes/i)).toBeInTheDocument();
    expect(screen.queryByText(/duration.*hours/i)).not.toBeInTheDocument();
  });

  it('renders the CadenceWarningBanner using the continuousMode context when continuous mode is selected', () => {
    render(
      <ScanControlSection
        {...baseProps({
          continuousMode: continuousMode({
            isContinuous: true,
            intervalMinutes: 1,
            cadenceContext: {
              platesPerScanner: 4,
              scannerCount: 5,
              dpi: 1200,
              regionMm: { width: 140, height: 140 },
            },
          }),
        })}
      />
    );
    expect(screen.getByTestId('cadence-warning-banner')).toBeInTheDocument();
  });
});
