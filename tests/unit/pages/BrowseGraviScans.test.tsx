import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  act,
  fireEvent,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { BrowseGraviScans } from '../../../src/renderer/BrowseGraviScans';

function makeExperiment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exp-1',
    name: 'Drought Study',
    hasNeedsReview: false,
    scientist: { name: 'Dr. Smith' },
    phenotypers: [{ name: 'Alice' }],
    accession: { id: 'acc-1', name: 'batch3.xlsx' },
    graviScans: [],
    resolution: 600,
    grid_mode: '2grid',
    ...overrides,
  };
}

describe('BrowseGraviScans', () => {
  let browseByExperiment: ReturnType<typeof vi.fn>;
  let downloadImages: ReturnType<typeof vi.fn>;
  let uploadAllScans: ReturnType<typeof vi.fn>;
  let getScanStatus: ReturnType<typeof vi.fn>;
  let listGraviMetadata: ReturnType<typeof vi.fn>;
  let intervalStartListeners: Array<() => void>;
  let intervalCompleteListeners: Array<() => void>;
  let cancelledListeners: Array<() => void>;
  let uploadProgressListeners: Array<(data: unknown) => void>;

  beforeEach(() => {
    browseByExperiment = vi.fn().mockResolvedValue({
      success: true,
      data: { experiments: [], total: 0 },
    });
    downloadImages = vi.fn().mockResolvedValue({ success: true });
    uploadAllScans = vi.fn().mockResolvedValue({
      success: true,
      uploaded: 3,
      skipped: 0,
      failed: 0,
      errors: [],
    });
    getScanStatus = vi
      .fn()
      .mockResolvedValue({ success: true, data: { isActive: false } });
    listGraviMetadata = vi.fn().mockResolvedValue({ success: true, data: [] });
    intervalStartListeners = [];
    intervalCompleteListeners = [];
    cancelledListeners = [];
    uploadProgressListeners = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = global.window as any;
    win.electron.database.graviscans = { browseByExperiment };
    win.electron.database.experiments = { listGraviMetadata };
    win.electron.gravi = {
      downloadImages,
      uploadAllScans,
      getScanStatus,
      onIntervalStart: vi.fn((cb: () => void) => {
        intervalStartListeners.push(cb);
        return vi.fn();
      }),
      onIntervalComplete: vi.fn((cb: () => void) => {
        intervalCompleteListeners.push(cb);
        return vi.fn();
      }),
      onCancelled: vi.fn((cb: () => void) => {
        cancelledListeners.push(cb);
        return vi.fn();
      }),
      onUploadProgress: vi.fn((cb: (data: unknown) => void) => {
        uploadProgressListeners.push(cb);
        return vi.fn();
      }),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderPage() {
    return render(
      <MemoryRouter>
        <BrowseGraviScans />
      </MemoryRouter>
    );
  }

  it('shows an empty-state message when there are no GraviScan experiments', async () => {
    renderPage();
    await waitFor(() => expect(browseByExperiment).toHaveBeenCalled());
    expect(screen.getByText(/no graviscan data/i)).toBeInTheDocument();
  });

  it('renders one row per experiment with expected fields', async () => {
    browseByExperiment.mockResolvedValue({
      success: true,
      data: { experiments: [makeExperiment()], total: 1 },
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Drought Study')).toBeInTheDocument();
    });
    expect(screen.getByText(/dr\. smith/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /view images/i })
    ).toBeInTheDocument();
  });

  it('Next/Previous pagination controls call browseByExperiment with an updated offset', async () => {
    browseByExperiment.mockResolvedValue({
      success: true,
      data: { experiments: [makeExperiment()], total: 1 },
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(browseByExperiment).toHaveBeenCalledTimes(1));
    expect(browseByExperiment).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 0 })
    );

    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await waitFor(() =>
      expect(browseByExperiment).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 20 })
      )
    );

    await user.click(screen.getByRole('button', { name: /^previous$/i }));
    await waitFor(() =>
      expect(browseByExperiment).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 0 })
      )
    );
  });

  it('disables Previous at offset 0', async () => {
    renderPage();
    await waitFor(() => expect(browseByExperiment).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /^previous$/i })).toBeDisabled();
  });

  it('shows a friendly message on a browseByExperiment error, without throwing', async () => {
    browseByExperiment.mockResolvedValue({
      success: false,
      error: 'DB unavailable',
    });

    expect(() => renderPage()).not.toThrow();
    await waitFor(() => {
      expect(screen.getByText(/DB unavailable/i)).toBeInTheDocument();
    });
  });

  it('debounces the experiment-name filter (300ms) before re-fetching', async () => {
    renderPage();
    await waitFor(() => expect(browseByExperiment).toHaveBeenCalled());
    browseByExperiment.mockClear();

    vi.useFakeTimers();
    try {
      const nameInput = screen.getByLabelText(/experiment name/i);
      fireEvent.change(nameInput, { target: { value: 'Drought' } });

      expect(browseByExperiment).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(browseByExperiment).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies the upload-status filter immediately, without debounce', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(browseByExperiment).toHaveBeenCalled());
    browseByExperiment.mockClear();

    const statusSelect = screen.getByLabelText(/upload status/i);
    await user.selectOptions(statusSelect, 'uploaded');

    await waitFor(() => expect(browseByExperiment).toHaveBeenCalled());
    const lastCall =
      browseByExperiment.mock.calls[browseByExperiment.mock.calls.length - 1];
    expect(lastCall[0].filters.uploadStatus).toBe('uploaded');
  });

  it('calls gravi.downloadImages with experimentId/experimentName/waveNumber on Download', async () => {
    browseByExperiment.mockResolvedValue({
      success: true,
      data: { experiments: [makeExperiment()], total: 1 },
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('Drought Study'));

    await user.click(screen.getByRole('button', { name: /^download$/i }));

    await waitFor(() => {
      expect(downloadImages).toHaveBeenCalledWith({
        experimentId: 'exp-1',
        experimentName: 'Drought Study',
        waveNumber: undefined,
      });
    });
  });

  describe('Box backup UI', () => {
    it('shows the idle state by default', async () => {
      renderPage();
      await waitFor(() => expect(getScanStatus).toHaveBeenCalled());
      expect(
        screen.getByRole('button', { name: /^backup to box$/i })
      ).toBeEnabled();
    });

    it('does not poll getScanStatus on an interval — calls it once on mount', async () => {
      vi.useFakeTimers();
      renderPage();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const callsAfterMount = getScanStatus.mock.calls.length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });
      expect(getScanStatus.mock.calls.length).toBe(callsAfterMount);
      vi.useRealTimers();
    });

    it('shows "Scan in progress..." and disables the button when onIntervalStart fires', async () => {
      renderPage();
      await waitFor(() => expect(getScanStatus).toHaveBeenCalled());

      act(() => {
        intervalStartListeners.forEach((cb) => cb());
      });

      expect(
        screen.getByRole('button', { name: /scan in progress/i })
      ).toBeDisabled();
    });

    it('re-enables the button when onIntervalComplete fires', async () => {
      renderPage();
      await waitFor(() => expect(getScanStatus).toHaveBeenCalled());
      act(() => intervalStartListeners.forEach((cb) => cb()));
      act(() => intervalCompleteListeners.forEach((cb) => cb()));

      expect(
        screen.getByRole('button', { name: /^backup to box$/i })
      ).toBeEnabled();
    });

    it('shows "Backing up..." while the backup call is in flight, then a success message', async () => {
      let resolveUpload: (value: unknown) => void = () => {};
      uploadAllScans.mockReturnValue(
        new Promise((resolve) => {
          resolveUpload = resolve;
        })
      );
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(getScanStatus).toHaveBeenCalled());

      await user.click(
        screen.getByRole('button', { name: /^backup to box$/i })
      );
      expect(
        screen.getByRole('button', { name: /backing up/i })
      ).toBeDisabled();

      await act(async () => {
        resolveUpload({ success: true, uploaded: 2, skipped: 1, failed: 0 });
      });

      await waitFor(() => {
        expect(screen.getByText(/uploaded.*2/i)).toBeInTheDocument();
      });
    });

    it('shows the failed count and first error on partial failure', async () => {
      uploadAllScans.mockResolvedValue({
        success: true,
        uploaded: 1,
        skipped: 0,
        failed: 1,
        errors: ['Network timeout'],
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(getScanStatus).toHaveBeenCalled());

      await user.click(
        screen.getByRole('button', { name: /^backup to box$/i })
      );

      await waitFor(() => {
        expect(screen.getByText(/network timeout/i)).toBeInTheDocument();
      });
    });

    it('shows a friendly "rclone not installed" message instead of the generic error', async () => {
      uploadAllScans.mockResolvedValue({
        success: true,
        uploaded: 0,
        skipped: 0,
        failed: 1,
        errors: ['rclone not installed'],
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(getScanStatus).toHaveBeenCalled());

      await user.click(
        screen.getByRole('button', { name: /^backup to box$/i })
      );

      await waitFor(() => {
        expect(
          screen.getByText(/box backup unavailable \(rclone not installed\)/i)
        ).toBeInTheDocument();
      });
    });

    it('updates the per-experiment Box progress indicator from onUploadProgress events', async () => {
      browseByExperiment.mockResolvedValue({
        success: true,
        data: { experiments: [makeExperiment()], total: 1 },
      });
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));

      act(() => {
        uploadProgressListeners.forEach((cb) =>
          cb({
            totalImages: 10,
            completedImages: 4,
            failedImages: 0,
            // box-backup.ts identifies the in-flight experiment by name,
            // not id — there is no id in the real payload to key by.
            currentExperiment: 'Drought Study',
          })
        );
      });

      await waitFor(() => {
        expect(screen.getByText(/box 4\/10/i)).toBeInTheDocument();
      });
    });
  });

  describe('mismatch warning', () => {
    it('warns before downloading a wave whose link differs from the experiment default accession', async () => {
      listGraviMetadata.mockResolvedValue({
        success: true,
        data: [
          {
            wave_number: 1,
            accession_id: 'acc-2',
            accession: { id: 'acc-2', name: 'other-file.xlsx' },
          },
        ],
      });
      browseByExperiment.mockResolvedValue({
        success: true,
        data: { experiments: [makeExperiment()], total: 1 },
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));
      await waitFor(() => expect(listGraviMetadata).toHaveBeenCalled());

      const waveSelect = screen.getByLabelText(/wave/i);
      await user.selectOptions(waveSelect, '1');
      await user.click(screen.getByRole('button', { name: /^download$/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/differs from the experiment's default accession/i)
        ).toBeInTheDocument();
      });
    });

    it('does not warn when the wave matches the experiment default accession', async () => {
      listGraviMetadata.mockResolvedValue({
        success: true,
        data: [
          {
            wave_number: 0,
            accession_id: 'acc-1',
            accession: { id: 'acc-1', name: 'batch3.xlsx' },
          },
        ],
      });
      browseByExperiment.mockResolvedValue({
        success: true,
        data: { experiments: [makeExperiment()], total: 1 },
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));
      await waitFor(() => expect(listGraviMetadata).toHaveBeenCalled());

      const waveSelect = screen.getByLabelText(/wave/i);
      await user.selectOptions(waveSelect, '0');
      await user.click(screen.getByRole('button', { name: /^download$/i }));

      await waitFor(() => expect(downloadImages).toHaveBeenCalled());
      expect(
        screen.queryByText(/differs from the experiment's default accession/i)
      ).not.toBeInTheDocument();
    });

    it('warns naming every diverged wave when "All Waves" is downloaded with two or more linked waves', async () => {
      listGraviMetadata.mockResolvedValue({
        success: true,
        data: [
          {
            wave_number: 0,
            accession_id: 'acc-1',
            accession: { id: 'acc-1', name: 'batch3.xlsx' },
          },
          {
            wave_number: 1,
            accession_id: 'acc-2',
            accession: { id: 'acc-2', name: 'other-file.xlsx' },
          },
          {
            wave_number: 2,
            accession_id: 'acc-3',
            accession: { id: 'acc-3', name: 'third-file.xlsx' },
          },
        ],
      });
      browseByExperiment.mockResolvedValue({
        success: true,
        data: { experiments: [makeExperiment()], total: 1 },
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));
      await waitFor(() => expect(listGraviMetadata).toHaveBeenCalled());

      // "All Waves" is the select's default — leave it unselected.
      await user.click(screen.getByRole('button', { name: /^download$/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/differs from the experiment's default accession/i)
        ).toBeInTheDocument();
      });
      const warning = screen.getByText(
        /differs from the experiment's default accession/i
      );
      expect(warning.textContent).toMatch(/1/);
      expect(warning.textContent).toMatch(/2/);
    });

    it('does not warn for "All Waves" when every linked wave matches the experiment default accession', async () => {
      listGraviMetadata.mockResolvedValue({
        success: true,
        data: [
          {
            wave_number: 0,
            accession_id: 'acc-1',
            accession: { id: 'acc-1', name: 'batch3.xlsx' },
          },
          {
            wave_number: 1,
            accession_id: 'acc-1',
            accession: { id: 'acc-1', name: 'batch3.xlsx' },
          },
        ],
      });
      browseByExperiment.mockResolvedValue({
        success: true,
        data: { experiments: [makeExperiment()], total: 1 },
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));
      await waitFor(() => expect(listGraviMetadata).toHaveBeenCalled());

      await user.click(screen.getByRole('button', { name: /^download$/i }));

      await waitFor(() => expect(downloadImages).toHaveBeenCalled());
      expect(
        screen.queryByText(/differs from the experiment's default accession/i)
      ).not.toBeInTheDocument();
    });
  });
});
