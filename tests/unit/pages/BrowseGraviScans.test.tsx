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
import { WaveMetadataLinksProvider } from '../../../src/renderer/contexts/WaveMetadataLinksContext';

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
    // graviscan:upload-all-scans goes through register-handlers.ts's
    // wrapHandler, which always envelopes the real result as
    // {success: true, data: <UploadAllScansResult>} (or {success: false,
    // error} if the handler threw) — the inner `success` field belongs to
    // the upload/backup outcome itself, not the envelope.
    uploadAllScans = vi.fn().mockResolvedValue({
      success: true,
      data: {
        success: true,
        uploaded: 3,
        skipped: 0,
        failed: 0,
        errors: [],
        metadataLinkingAvailable: false,
      },
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
      <WaveMetadataLinksProvider>
        <MemoryRouter>
          <BrowseGraviScans />
        </MemoryRouter>
      </WaveMetadataLinksProvider>
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

  it('shows a wave-metadata link error on the experiment row instead of silently leaving the wave selector stale', async () => {
    // WaveMetadataLinksContext already surfaces IPC/retry failures via
    // linkError (round 2/3 fixes) — but ExperimentRow only destructured
    // `links`, never `linkError`, so a failed/stale fetch here (the exact
    // page an operator uses to decide which wave to download) showed
    // nothing was wrong at all.
    browseByExperiment.mockResolvedValue({
      success: true,
      data: { experiments: [makeExperiment()], total: 1 },
    });
    listGraviMetadata.mockResolvedValue({
      success: false,
      error: 'Database is locked',
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Drought Study')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/database is locked/i)).toBeInTheDocument();
    });
  });

  it('disables Download while the wave-metadata link fetch has failed, instead of silently reporting no divergence', async () => {
    // handleDownload's diverged-wave check filters over `links`, which
    // stays [] on a failed fetch — reporting zero divergence isn't "no
    // divergence", it's "unknown", since we never actually loaded the
    // wave's real linked accession. Downloading in that state could hand
    // the operator a CSV whose accession is wrong with no warning at all.
    browseByExperiment.mockResolvedValue({
      success: true,
      data: { experiments: [makeExperiment()], total: 1 },
    });
    listGraviMetadata.mockResolvedValue({
      success: false,
      error: 'Database is locked',
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/database is locked/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /^download$/i })).toBeDisabled();
  });

  it('Next/Previous pagination controls call browseByExperiment with an updated offset', async () => {
    browseByExperiment.mockResolvedValue({
      success: true,
      // total (21) exceeds one page (20) so Next stays enabled at offset 0.
      data: { experiments: [makeExperiment()], total: 21 },
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

  it('disables Next when the current page reaches the total result count', async () => {
    browseByExperiment.mockResolvedValue({
      success: true,
      data: { experiments: [makeExperiment()], total: 1 },
    });
    renderPage();
    await waitFor(() => expect(browseByExperiment).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled();
  });

  it('disables Next when total exactly equals one page (PAGE_SIZE = 20) — the boundary of offset + PAGE_SIZE >= total', async () => {
    browseByExperiment.mockResolvedValue({
      success: true,
      data: { experiments: [makeExperiment()], total: 20 },
    });
    renderPage();
    await waitFor(() => expect(browseByExperiment).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled();
  });

  it('disables Next when there are zero results', async () => {
    browseByExperiment.mockResolvedValue({
      success: true,
      data: { experiments: [], total: 0 },
    });
    renderPage();
    await waitFor(() => expect(browseByExperiment).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled();
  });

  it('re-enables Next on a later page that still has more results beyond it', async () => {
    browseByExperiment.mockResolvedValue({
      success: true,
      data: { experiments: [makeExperiment()], total: 45 },
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(browseByExperiment).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await waitFor(() =>
      expect(browseByExperiment).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 20 })
      )
    );
    // offset 20 + PAGE_SIZE 20 = 40, still < total 45 — more results remain.
    expect(screen.getByRole('button', { name: /^next$/i })).toBeEnabled();
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
        resolveUpload({
          success: true,
          data: {
            success: true,
            uploaded: 2,
            skipped: 1,
            failed: 0,
            errors: [],
            metadataLinkingAvailable: false,
            bloomSuccess: true,
            boxSuccess: true,
            bloomUploaded: 1,
            boxUploaded: 1,
            bloomErrors: [],
            boxErrors: [],
          },
        });
      });

      await waitFor(() => {
        expect(screen.getByText(/uploaded.*2/i)).toBeInTheDocument();
      });
    });

    it('shows the failed count and first error on partial failure', async () => {
      uploadAllScans.mockResolvedValue({
        success: true,
        data: {
          success: false,
          uploaded: 1,
          skipped: 0,
          failed: 1,
          errors: ['Network timeout'],
          metadataLinkingAvailable: false,
          bloomSuccess: true,
          boxSuccess: false,
          bloomUploaded: 1,
          boxUploaded: 0,
          bloomErrors: [],
          boxErrors: ['Network timeout'],
        },
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

    it('shows a friendly "rclone not installed" message instead of the generic error, noting Bloom was up to date', async () => {
      uploadAllScans.mockResolvedValue({
        success: true,
        data: {
          success: false,
          uploaded: 0,
          skipped: 0,
          failed: 1,
          errors: ['rclone not installed'],
          metadataLinkingAvailable: false,
          bloomSuccess: true,
          boxSuccess: false,
          bloomUploaded: 0,
          boxUploaded: 0,
          bloomErrors: [],
          boxErrors: ['rclone not installed'],
        },
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
        // Bloom succeeded but had nothing pending — an operator seeing
        // only the Box message and no Bloom mention at all couldn't tell
        // that apart from "Bloom wasn't even checked".
        expect(
          screen.getByText(/bloom.*up to date.*nothing to upload/i)
        ).toBeInTheDocument();
      });
    });

    it('notes successful Bloom uploads alongside the rclone-not-installed message', async () => {
      // The rclone-not-installed branch previously ignored `uploaded`
      // entirely — if Bloom uploaded real files while Box failed only
      // because rclone isn't installed, those Bloom uploads were silently
      // dropped from the message.
      uploadAllScans.mockResolvedValue({
        success: true,
        data: {
          success: false,
          uploaded: 5,
          skipped: 0,
          failed: 1,
          errors: ['rclone not installed'],
          metadataLinkingAvailable: false,
          bloomSuccess: true,
          boxSuccess: false,
          bloomUploaded: 5,
          boxUploaded: 0,
          bloomErrors: [],
          boxErrors: ['rclone not installed'],
        },
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
        expect(screen.getByText(/bloom.*5 uploaded/i)).toBeInTheDocument();
      });
    });

    it('notes a Bloom failure alongside the rclone-not-installed message instead of hiding it', async () => {
      uploadAllScans.mockResolvedValue({
        success: true,
        data: {
          success: false,
          uploaded: 0,
          skipped: 0,
          failed: 2,
          errors: [
            'rclone not installed',
            'Authentication failed: token expired',
          ],
          metadataLinkingAvailable: false,
          bloomSuccess: false,
          boxSuccess: false,
          bloomUploaded: 0,
          boxUploaded: 0,
          bloomErrors: ['Authentication failed: token expired'],
          boxErrors: ['rclone not installed'],
        },
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
        expect(
          screen.getByText(
            /bloom.*failed.*authentication failed: token expired/i
          )
        ).toBeInTheDocument();
      });
    });

    it('shows a friendly message when the IPC handler itself throws', async () => {
      uploadAllScans.mockResolvedValue({
        success: false,
        error: 'Database connection lost',
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(getScanStatus).toHaveBeenCalled());

      await user.click(
        screen.getByRole('button', { name: /^backup to box$/i })
      );

      await waitFor(() => {
        expect(
          screen.getByText(/backup failed.*database connection lost/i)
        ).toBeInTheDocument();
      });
    });

    it('reports a whole-operation failure instead of a false "Uploaded 0" success message', async () => {
      // Mirrors uploadAllScans()'s uploadInProgress guard: the inner
      // domain result reports success:false with nothing uploaded or
      // failed (it never even attempted an image), which previously
      // matched neither the rclone-specific nor the failed>0 branch and
      // fell through to the generic success message.
      uploadAllScans.mockResolvedValue({
        success: true,
        data: {
          success: false,
          uploaded: 0,
          skipped: 0,
          failed: 0,
          errors: ['Upload already in progress'],
          metadataLinkingAvailable: false,
          bloomSuccess: true,
          boxSuccess: true,
          bloomUploaded: 0,
          boxUploaded: 0,
          bloomErrors: [],
          boxErrors: [],
        },
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(getScanStatus).toHaveBeenCalled());

      await user.click(
        screen.getByRole('button', { name: /^backup to box$/i })
      );

      await waitFor(() => {
        expect(
          screen.getByText(/backup failed.*upload already in progress/i)
        ).toBeInTheDocument();
      });
      expect(screen.queryByText(/uploaded 0 image/i)).not.toBeInTheDocument();
    });

    it('shows both the success and failure counts on a partial failure', async () => {
      uploadAllScans.mockResolvedValue({
        success: true,
        data: {
          success: false,
          uploaded: 3,
          skipped: 0,
          failed: 1,
          errors: ['Network timeout'],
          metadataLinkingAvailable: false,
          bloomSuccess: true,
          boxSuccess: false,
          bloomUploaded: 3,
          boxUploaded: 0,
          bloomErrors: [],
          boxErrors: ['Network timeout'],
        },
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(getScanStatus).toHaveBeenCalled());

      await user.click(
        screen.getByRole('button', { name: /^backup to box$/i })
      );

      await waitFor(() => {
        expect(screen.getByText(/3 uploaded/i)).toBeInTheDocument();
        expect(screen.getByText(/1 error/i)).toBeInTheDocument();
      });
    });

    it('attributes a Bloom failure by name, not "Box backup failed", when Box uploads succeed but Bloom fails (uploaded>0, failed:0)', async () => {
      // uploadAllScans() merges Bloom + Box results with success:
      // bloomResult.success && boxResult.success, but uploaded/failed are
      // additive across both targets. So Box fully succeeding (its
      // filesCopied contribute to `uploaded`, its empty errors contribute
      // nothing to `failed`) while Bloom fails outright (contributing 0 to
      // `uploaded`/`failed` but an error string) produces exactly this
      // shape: success:false, uploaded>0, failed:0. That must not be
      // reported as a generic "Box backup failed" — Box actually succeeded;
      // Bloom (the record-of-truth database) is what failed, and the
      // message must name it explicitly rather than leaving a technician to
      // assume the successfully-mentioned system ("Box") is the failing one.
      uploadAllScans.mockResolvedValue({
        success: true,
        data: {
          success: false,
          uploaded: 2,
          skipped: 0,
          failed: 0,
          errors: ['Authentication failed: Bloom session expired'],
          metadataLinkingAvailable: false,
          bloomSuccess: false,
          boxSuccess: true,
          bloomUploaded: 0,
          boxUploaded: 2,
          bloomErrors: ['Authentication failed: Bloom session expired'],
          boxErrors: [],
        },
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(getScanStatus).toHaveBeenCalled());

      await user.click(
        screen.getByRole('button', { name: /^backup to box$/i })
      );

      await waitFor(() => {
        expect(screen.getByText(/2 uploaded/i)).toBeInTheDocument();
        expect(
          screen.getByText(
            /bloom failed.*authentication failed: bloom session expired/i
          )
        ).toBeInTheDocument();
      });
      expect(screen.queryByText(/^box backup failed/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/box failed/i)).not.toBeInTheDocument();
    });

    it('attributes a Box failure by name when Box fails but Bloom succeeds', async () => {
      uploadAllScans.mockResolvedValue({
        success: true,
        data: {
          success: false,
          uploaded: 5,
          skipped: 0,
          // uploadAllScans()'s merge formula is failed: bloomResult.failed
          // + boxResult.errors.length — always >=1 whenever boxErrors is
          // non-empty, so failed:0 here would be an impossible real shape.
          failed: 1,
          errors: ['rclone exited with code 1'],
          metadataLinkingAvailable: false,
          bloomSuccess: true,
          boxSuccess: false,
          bloomUploaded: 5,
          boxUploaded: 0,
          bloomErrors: [],
          boxErrors: ['rclone exited with code 1'],
        },
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(getScanStatus).toHaveBeenCalled());

      await user.click(
        screen.getByRole('button', { name: /^backup to box$/i })
      );

      await waitFor(() => {
        expect(screen.getByText(/5 uploaded/i)).toBeInTheDocument();
        expect(
          screen.getByText(/box failed.*rclone exited with code 1/i)
        ).toBeInTheDocument();
      });
      expect(screen.queryByText(/bloom failed/i)).not.toBeInTheDocument();
    });

    it('names BOTH systems when Bloom and Box fail simultaneously with nothing uploaded, instead of falling through to a generic message', async () => {
      // Round 3's "uploaded > 0 && errors.length > 0" gate skips this case
      // entirely (uploaded is 0), so a genuine dual failure — e.g. a lab
      // network outage that takes out both Bloom auth and the Box network
      // call at once — fell through to the generic `!result.success`
      // branch, which shows only errors[0] (Bloom's) and names neither
      // system. That's the exact conflation round 3 was meant to fix, in
      // its worst-case form.
      uploadAllScans.mockResolvedValue({
        success: true,
        data: {
          success: false,
          uploaded: 0,
          skipped: 0,
          failed: 1,
          errors: [
            'Authentication failed: Bloom session expired',
            'Network timeout',
          ],
          metadataLinkingAvailable: false,
          bloomSuccess: false,
          boxSuccess: false,
          bloomUploaded: 0,
          boxUploaded: 0,
          bloomErrors: ['Authentication failed: Bloom session expired'],
          boxErrors: ['Network timeout'],
        },
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(getScanStatus).toHaveBeenCalled());

      await user.click(
        screen.getByRole('button', { name: /^backup to box$/i })
      );

      await waitFor(() => {
        expect(
          screen.getByText(
            /bloom failed.*authentication failed: bloom session expired/i
          )
        ).toBeInTheDocument();
        expect(
          screen.getByText(/box failed.*network timeout/i)
        ).toBeInTheDocument();
      });
    });

    it('shows a friendly message when the IPC call itself rejects', async () => {
      uploadAllScans.mockRejectedValue(new Error('IPC channel closed'));
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(getScanStatus).toHaveBeenCalled());

      await user.click(
        screen.getByRole('button', { name: /^backup to box$/i })
      );

      await waitFor(() => {
        expect(
          screen.getByText(/backup failed.*ipc channel closed/i)
        ).toBeInTheDocument();
      });
      expect(
        screen.getByRole('button', { name: /^backup to box$/i })
      ).toBeEnabled();
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
      expect(warning.textContent).toMatch(/waves 1, 2/i);
      // Wave 0 matches the default accession — it must NOT be named
      // alongside the two that actually diverge (a naive "include every
      // linked wave" regression would still pass a bare /1/ /2/ check).
      expect(warning.textContent).not.toMatch(/waves? 0/i);
      expect(warning.textContent).not.toMatch(/0,/);
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
