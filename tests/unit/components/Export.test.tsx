/**
 * Unit Tests: Export page
 *
 * Covers behaviors with no existing precedent to lean on (tri-state
 * group-header checkbox, per-group scan-count label, the pilot's
 * "stuck on Exporting... forever" regression, distinct failed-vs-skipped
 * banner detail, the disconnect warning, discrete progress updates, and
 * progress-listener cleanup on unmount) per tasks.md section 3.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { Export } from '../../../src/renderer/Export';

function makeScan(
  id: string,
  overrides: Partial<{
    experiment_id: string;
    experimentName: string;
    plant_id: string;
    capture_date: Date;
  }> = {}
) {
  const experimentId = overrides.experiment_id ?? 'exp-1';
  return {
    id,
    experiment_id: experimentId,
    phenotyper_id: 'phen-1',
    scanner_name: 'Station-A',
    plant_id: overrides.plant_id ?? `PLANT-${id}`,
    accession_name: 'Col-0',
    path: `2026-01-05/PLANT-${id}/${id}`,
    capture_date: overrides.capture_date ?? new Date('2026-01-05T10:00:00'),
    num_frames: 2,
    exposure_time: 10000,
    gain: 5,
    brightness: 0.5,
    contrast: 1,
    gamma: 1,
    seconds_per_rot: 36,
    wave_number: 1,
    plant_age_days: 14,
    deleted: false,
    images: [],
    experiment: {
      id: experimentId,
      name: overrides.experimentName ?? 'Experiment A',
    },
    phenotyper: { id: 'phen-1', name: 'Test Phenotyper' },
  };
}

function mockList(scans: ReturnType<typeof makeScan>[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  win.electron.database.scans.list = vi.fn().mockResolvedValue({
    success: true,
    data: { scans, total: scans.length, page: 1, pageSize: 100 },
  });
}

function getDb() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (global.window as any).electron.database.scans;
}

function getConfig() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (global.window as any).electron.config;
}

beforeEach(() => {
  mockList([]);
  getDb().export = vi.fn().mockResolvedValue({
    success: true,
    data: {
      exportedFiles: 0,
      exportedScans: 0,
      skippedFiles: 0,
      failedScans: [],
    },
  });
  getDb().onExportProgress = vi.fn().mockReturnValue(vi.fn());
  getConfig().browseDirectory = vi.fn().mockResolvedValue('/fake/destination');
});

async function pickDestination(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Choose Destination' }));
  await screen.findByText('/fake/destination');
}

describe('Export page', () => {
  it('group-header checkbox is indeterminate when only some scans in the group are selected, checked when all are', async () => {
    const user = userEvent.setup();
    mockList([makeScan('a'), makeScan('b')]);
    render(<Export />);

    await screen.findByText(/Experiment A/);
    const groupCheckbox = screen.getByLabelText('Select all scans in group');
    const scanCheckboxes = screen
      .getAllByRole('checkbox')
      .filter((cb) => cb !== groupCheckbox);
    expect(scanCheckboxes).toHaveLength(2);

    await user.click(scanCheckboxes[0]);
    expect(groupCheckbox).not.toBeChecked();
    expect((groupCheckbox as HTMLInputElement).indeterminate).toBe(true);

    await user.click(scanCheckboxes[1]);
    expect(groupCheckbox).toBeChecked();
    expect((groupCheckbox as HTMLInputElement).indeterminate).toBe(false);
  });

  it('clicking the group-header checkbox selects every scan in the group, and clicking it again deselects them all', async () => {
    const user = userEvent.setup();
    mockList([makeScan('a'), makeScan('b'), makeScan('c')]);
    render(<Export />);

    await screen.findByText(/Experiment A/);
    const groupCheckbox = screen.getByLabelText('Select all scans in group');
    const scanCheckboxes = screen
      .getAllByRole('checkbox')
      .filter((cb) => cb !== groupCheckbox);
    expect(scanCheckboxes).toHaveLength(3);

    await user.click(groupCheckbox);
    expect(screen.getByText('3 scans selected')).toBeInTheDocument();
    for (const cb of scanCheckboxes) {
      expect(cb).toBeChecked();
    }
    expect(groupCheckbox).toBeChecked();

    await user.click(groupCheckbox);
    expect(screen.getByText('0 scans selected')).toBeInTheDocument();
    for (const cb of scanCheckboxes) {
      expect(cb).not.toBeChecked();
    }
  });

  it('renders the group header with a scan-count label', async () => {
    mockList([makeScan('a'), makeScan('b'), makeScan('c')]);
    render(<Export />);

    expect(
      await screen.findByText(/Experiment A.*\(3 scans\)/)
    ).toBeInTheDocument();
  });

  it('leaves the export button out of its loading state and shows an error when export() resolves { success: false }', async () => {
    const user = userEvent.setup();
    mockList([makeScan('a')]);
    getDb().export = vi.fn().mockResolvedValue({
      success: false,
      error: 'Destination is not writable',
    });
    render(<Export />);

    await screen.findByText(/Experiment A/);
    await user.click(screen.getAllByRole('checkbox')[1]);
    await pickDestination(user);

    const exportButton = screen.getByRole('button', { name: /Export 1 scan/ });
    await user.click(exportButton);

    await waitFor(() => {
      expect(
        screen.getByText('Destination is not writable')
      ).toBeInTheDocument();
    });
    // Button must have left its loading state (and selection is preserved on
    // failure so the user can retry) — this is the direct regression test
    // for the pilot's "stuck on Exporting... forever" bug.
    expect(screen.getByRole('button', { name: /Export 1 scan/ })).toBeEnabled();
  });

  it('leaves the export button out of its loading state and shows an error when export() rejects', async () => {
    const user = userEvent.setup();
    mockList([makeScan('a')]);
    getDb().export = vi.fn().mockRejectedValue(new Error('network down'));
    render(<Export />);

    await screen.findByText(/Experiment A/);
    await user.click(screen.getAllByRole('checkbox')[1]);
    await pickDestination(user);
    await user.click(screen.getByRole('button', { name: /Export 1 scan/ }));

    await waitFor(() => {
      expect(
        screen.getByText('An unexpected error occurred during export')
      ).toBeInTheDocument();
    });
    expect(screen.queryByText('Exporting…')).not.toBeInTheDocument();
  });

  it('shows failed scans by experiment and full capture timestamp, distinct from the skipped count', async () => {
    const user = userEvent.setup();
    const failedCaptureDate = new Date('2026-01-05T14:30:00');
    mockList([makeScan('a')]);
    getDb().export = vi.fn().mockResolvedValue({
      success: true,
      data: {
        exportedFiles: 3,
        exportedScans: 1,
        skippedFiles: 2,
        failedScans: [
          {
            scanId: 'zzz',
            experimentName: 'Experiment A',
            captureDate: failedCaptureDate,
            reason: 'Could not read scan source folder',
          },
        ],
      },
    });
    render(<Export />);

    await screen.findByText(/Experiment A/);
    await user.click(screen.getAllByRole('checkbox')[1]);
    await pickDestination(user);
    await user.click(screen.getByRole('button', { name: /Export 1 scan/ }));

    await waitFor(() => {
      expect(screen.getByText('1 scan failed:')).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        '1 scan exported (3 files), 2 files skipped (already exist)'
      )
    ).toBeInTheDocument();
    // Full date AND time — not just the day — per design.md's disambiguation requirement.
    expect(
      screen.getByText(
        (text) => text.includes('Experiment A') && text.includes('2:30 PM')
      )
    ).toBeInTheDocument();
  });

  it('when every selected scan fails outright, shows only the failure list — not a nonsensical "0 scans already exported" summary', async () => {
    const user = userEvent.setup();
    const failedCaptureDate = new Date('2026-01-05T14:30:00');
    mockList([makeScan('a')]);
    getDb().export = vi.fn().mockResolvedValue({
      success: true,
      data: {
        exportedFiles: 0,
        exportedScans: 0,
        skippedFiles: 0,
        failedScans: [
          {
            scanId: 'zzz',
            experimentName: 'Experiment A',
            captureDate: failedCaptureDate,
            reason: 'Could not read scan source folder',
          },
        ],
      },
    });
    render(<Export />);

    await screen.findByText(/Experiment A/);
    await user.click(screen.getAllByRole('checkbox')[1]);
    await pickDestination(user);
    await user.click(screen.getByRole('button', { name: /Export 1 scan/ }));

    await waitFor(() => {
      expect(screen.getByText('1 scan failed:')).toBeInTheDocument();
    });
    expect(screen.queryByText(/already exported/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/scans? exported/i)).not.toBeInTheDocument();
  });

  it('re-exporting a scan whose files all already exist shows "already exported — all N files already present", not the self-contradictory "exported (already present)"', async () => {
    const user = userEvent.setup();
    mockList([makeScan('a')]);
    getDb().export = vi.fn().mockResolvedValue({
      success: true,
      data: {
        exportedFiles: 0,
        exportedScans: 1,
        skippedFiles: 2,
        failedScans: [],
      },
    });
    render(<Export />);

    await screen.findByText(/Experiment A/);
    await user.click(screen.getAllByRole('checkbox')[1]);
    await pickDestination(user);
    await user.click(screen.getByRole('button', { name: /Export 1 scan/ }));

    await waitFor(() => {
      expect(
        screen.getByText(
          '1 scan already exported — all 2 files already present'
        )
      ).toBeInTheDocument();
    });
    // Regression guard: "exported" must never appear paired with "already
    // present" in the same clause when nothing new was copied — that
    // reads as self-contradictory (did it export or not?).
    expect(
      screen.queryByText(/exported \(already present\)/i)
    ).not.toBeInTheDocument();
  });

  it('shows an honest "no scans exported" message instead of "0 scans exported (already present)" when the selection resolves to nothing (e.g. deleted elsewhere)', async () => {
    const user = userEvent.setup();
    mockList([makeScan('a')]);
    getDb().export = vi.fn().mockResolvedValue({
      success: true,
      data: {
        exportedFiles: 0,
        exportedScans: 0,
        skippedFiles: 0,
        failedScans: [],
      },
    });
    render(<Export />);

    await screen.findByText(/Experiment A/);
    await user.click(screen.getAllByRole('checkbox')[1]);
    await pickDestination(user);
    await user.click(screen.getByRole('button', { name: /Export 1 scan/ }));

    await waitFor(() => {
      expect(screen.getByText(/No scans were exported/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/exported \(already present\)/i)
    ).not.toBeInTheDocument();
  });

  it('confirms before discarding an unread partial-failure banner when starting another export, and honors cancel', async () => {
    const user = userEvent.setup();
    mockList([makeScan('a')]);
    getDb().export = vi.fn().mockResolvedValue({
      success: true,
      data: {
        exportedFiles: 1,
        exportedScans: 1,
        skippedFiles: 0,
        failedScans: [
          {
            scanId: 'zzz',
            experimentName: 'Experiment A',
            captureDate: new Date('2026-01-05T14:30:00'),
            reason: 'boom',
          },
        ],
      },
    });
    render(<Export />);

    await screen.findByText(/Experiment A/);
    await user.click(screen.getAllByRole('checkbox')[1]);
    await pickDestination(user);
    await user.click(screen.getByRole('button', { name: /Export 1 scan/ }));
    await waitFor(() => {
      expect(screen.getByText('1 scan failed:')).toBeInTheDocument();
    });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(screen.getAllByRole('checkbox')[1]);
    await user.click(screen.getByRole('button', { name: /Export 1 scan/ }));

    expect(confirmSpy).toHaveBeenCalled();
    // Cancelled: the stale failure banner must still be visible, and export()
    // must not have been called a second time.
    expect(screen.getByText('1 scan failed:')).toBeInTheDocument();
    expect(getDb().export).toHaveBeenCalledTimes(1);

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: /Export 1 scan/ }));
    expect(getDb().export).toHaveBeenCalledTimes(2);
  });

  it('shows a persistent disconnect warning while exporting, which disappears once the completion banner appears', async () => {
    const user = userEvent.setup();
    mockList([makeScan('a')]);
    let resolveExport: (value: unknown) => void = () => {};
    getDb().export = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        })
    );
    render(<Export />);

    await screen.findByText(/Experiment A/);
    await user.click(screen.getAllByRole('checkbox')[1]);
    await pickDestination(user);
    await user.click(screen.getByRole('button', { name: /Export 1 scan/ }));

    expect(
      await screen.findByText(/Do not disconnect the destination/)
    ).toBeInTheDocument();

    resolveExport({
      success: true,
      data: {
        exportedFiles: 1,
        exportedScans: 1,
        skippedFiles: 0,
        failedScans: [],
      },
    });

    await waitFor(() => {
      expect(
        screen.queryByText(/Do not disconnect the destination/)
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByText(
        '1 scan exported (1 file), 0 files skipped (already exist)'
      )
    ).toBeInTheDocument();
  });

  it('updates the progress indicator as discrete onExportProgress events arrive', async () => {
    const user = userEvent.setup();
    mockList([makeScan('a')]);
    let capturedCallback: ((p: unknown) => void) | null = null;
    getDb().onExportProgress = vi.fn().mockImplementation((cb) => {
      capturedCallback = cb;
      return vi.fn();
    });
    let resolveExport: (value: unknown) => void = () => {};
    getDb().export = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        })
    );
    render(<Export />);

    await screen.findByText(/Experiment A/);
    await user.click(screen.getAllByRole('checkbox')[1]);
    await pickDestination(user);
    await user.click(screen.getByRole('button', { name: /Export 1 scan/ }));

    await waitFor(() => expect(capturedCallback).not.toBeNull());

    act(() => {
      capturedCallback!({
        totalFiles: 3,
        completedFiles: 1,
        currentScanId: 'a',
      });
    });
    expect(
      await screen.findByText('1 of 3 files processed…')
    ).toBeInTheDocument();

    act(() => {
      capturedCallback!({
        totalFiles: 3,
        completedFiles: 2,
        currentScanId: 'a',
      });
    });
    expect(
      await screen.findByText('2 of 3 files processed…')
    ).toBeInTheDocument();

    resolveExport({
      success: true,
      data: {
        exportedFiles: 3,
        exportedScans: 1,
        skippedFiles: 0,
        failedScans: [],
      },
    });
  });

  it('calls the onExportProgress cleanup function when the page unmounts mid-export', async () => {
    const user = userEvent.setup();
    mockList([makeScan('a')]);
    const cleanup = vi.fn();
    getDb().onExportProgress = vi.fn().mockReturnValue(cleanup);
    getDb().export = vi.fn().mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(<Export />);

    await screen.findByText(/Experiment A/);
    await user.click(screen.getAllByRole('checkbox')[1]);
    await pickDestination(user);
    await user.click(screen.getByRole('button', { name: /Export 1 scan/ }));

    await waitFor(() => expect(getDb().onExportProgress).toHaveBeenCalled());
    expect(cleanup).not.toHaveBeenCalled();

    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('shows the empty-state message when there are no scans', async () => {
    mockList([]);
    render(<Export />);
    expect(await screen.findByText('No scans to export')).toBeInTheDocument();
  });

  it('disables the export action until both a destination and at least one scan are selected', async () => {
    const user = userEvent.setup();
    mockList([makeScan('a')]);
    render(<Export />);

    await screen.findByText(/Experiment A/);
    expect(screen.getByText('0 scans selected')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Export 0 scan/ })
    ).toBeDisabled();

    await user.click(screen.getAllByRole('checkbox')[1]);
    expect(screen.getByText('1 scan selected')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Export 1 scan/ })
    ).toBeDisabled();

    await pickDestination(user);
    expect(screen.getByRole('button', { name: /Export 1 scan/ })).toBeEnabled();
  });

  it('uses lime on the Export button, not blue (Tier 4 style/UX parity — Export.tsx is an unconditional, both-mode route like BrowseScans.tsx/ScanPreview.tsx)', async () => {
    mockList([makeScan('a')]);
    render(<Export />);

    await screen.findByText(/Experiment A/);
    const exportButton = screen.getByRole('button', { name: /Export 0 scan/ });
    expect(exportButton.className).toContain('bg-lime-700');
    expect(exportButton.className).toContain('hover:bg-lime-800');
    expect(exportButton.className).not.toMatch(/bg-blue-600|hover:bg-blue-700/);
  });
});
