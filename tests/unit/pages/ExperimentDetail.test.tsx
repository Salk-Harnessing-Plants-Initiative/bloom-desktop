import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ExperimentDetail } from '../../../src/renderer/ExperimentDetail';
import { WaveMetadataLinksProvider } from '../../../src/renderer/contexts/WaveMetadataLinksContext';

function makeScan(overrides: Record<string, unknown> = {}) {
  // `scanner` defaults to mirroring whatever `scanner_id` resolves to (so
  // every pre-existing test that only overrides `scanner_id` keeps working
  // unchanged) — pass an explicit `scanner: {...}` to test real
  // name/display_name behavior distinct from the id.
  const scanner_id = (overrides.scanner_id as string) ?? 'scanner-1';
  return {
    id: 'scan-1',
    scanner_id,
    plate_index: '00',
    wave_number: 0,
    resolution: 600,
    grid_mode: '2grid',
    capture_date: '2026-08-01T00:00:00.000Z',
    transplant_date: '2026-07-01T00:00:00.000Z',
    custom_note: 'note',
    plate_barcode: 'BC-1',
    path: '/scans/scan-1.tiff',
    scanner: { name: scanner_id, display_name: null },
    ...overrides,
  };
}

describe('ExperimentDetail', () => {
  let experimentsGet: ReturnType<typeof vi.fn>;
  let experimentDetail: ReturnType<typeof vi.fn>;
  let listGraviMetadata: ReturnType<typeof vi.fn>;
  let linkGraviMetadata: ReturnType<typeof vi.fn>;
  let unlinkGraviMetadata: ReturnType<typeof vi.fn>;
  let listFiles: ReturnType<typeof vi.fn>;
  let readScanImage: ReturnType<typeof vi.fn>;
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    experimentsGet = vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: 'exp-1',
        name: 'Drought Study',
        scientist: { name: 'Dr. Smith' },
        accession: { id: 'acc-1', name: 'batch3.xlsx' },
      },
    });
    experimentDetail = vi.fn().mockResolvedValue({
      success: true,
      data: { scans: [], verificationStatusMap: {} },
    });
    listGraviMetadata = vi.fn().mockResolvedValue({ success: true, data: [] });
    linkGraviMetadata = vi.fn().mockResolvedValue({ success: true });
    unlinkGraviMetadata = vi.fn().mockResolvedValue({ success: true });
    listFiles = vi.fn().mockResolvedValue({
      success: true,
      data: [{ id: 'acc-2', name: 'other.xlsx' }],
    });
    readScanImage = vi.fn().mockResolvedValue({
      success: true,
      dataUri: 'data:image/jpeg;base64,abc',
    });
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = global.window as any;
    win.electron.database.experiments = {
      get: experimentsGet,
      listGraviMetadata,
      linkGraviMetadata,
      unlinkGraviMetadata,
    };
    win.electron.database.graviscans = { experimentDetail };
    win.electron.database.graviPlateAccessions = { listFiles };
    win.electron.gravi = { readScanImage };
  });

  function renderPage(experimentId = 'exp-1') {
    return render(
      <WaveMetadataLinksProvider>
        <MemoryRouter
          initialEntries={[`/graviscan-experiment/${experimentId}`]}
        >
          <Routes>
            <Route
              path="/graviscan-experiment/:experimentId"
              element={<ExperimentDetail />}
            />
            {/* A placeholder for the real BrowseGraviScans route — this
                test only needs to prove "Back to Browse" performs
                client-side navigation to this path, not exercise the real
                page. */}
            <Route
              path="/browse-graviscans"
              element={<div>Browse GraviScans Page</div>}
            />
          </Routes>
        </MemoryRouter>
      </WaveMetadataLinksProvider>
    );
  }

  it('renders the metadata summary', async () => {
    experimentDetail.mockResolvedValue({
      success: true,
      data: { scans: [makeScan()], verificationStatusMap: {} },
    });
    renderPage();
    await waitFor(() => screen.getByText('Drought Study'));
    expect(screen.getByText(/dr\. smith/i)).toBeInTheDocument();
    expect(screen.getByText(/600/)).toBeInTheDocument();
    expect(screen.getByText(/2grid/)).toBeInTheDocument();
  });

  it('"Back to Browse" navigates client-side via React Router, not a real page load', async () => {
    // A plain <a href="/browse-graviscans"> would fall through to the dev
    // server, which has no such HTTP route, producing "Cannot GET
    // /browse-graviscans" and leaving the operator stuck outside the SPA
    // entirely (confirmed manually). jsdom doesn't implement real
    // navigation, so this only passes if the link is a React Router `Link`
    // (client-side intercept) — a bare `<a>` would leave this route's
    // placeholder never rendered.
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('Drought Study'));

    await user.click(screen.getByRole('link', { name: /back to browse/i }));

    await waitFor(() => {
      expect(screen.getByText('Browse GraviScans Page')).toBeInTheDocument();
    });
  });

  describe('summary strip aggregates (Decision 12)', () => {
    it('shows phenotyper name(s) and a date range computed from the scans', async () => {
      experimentDetail.mockResolvedValue({
        success: true,
        data: {
          scans: [
            makeScan({
              phenotyper: { name: 'Alice' },
              capture_date: '2026-06-15T00:00:00.000Z',
            }),
            makeScan({
              id: 'scan-2',
              phenotyper: { name: 'Bob' },
              capture_date: '2026-06-20T00:00:00.000Z',
            }),
          ],
          verificationStatusMap: {},
        },
      });
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));

      expect(screen.getByText(/alice, bob/i)).toBeInTheDocument();
    });

    it('shows resolution/grid-mode as the distinct set across ALL scans, not just scans[0] — reproduces the first-scan-only bug', async () => {
      experimentDetail.mockResolvedValue({
        success: true,
        data: {
          scans: [
            makeScan({ resolution: 600, grid_mode: '2grid' }),
            makeScan({ id: 'scan-2', resolution: 800, grid_mode: '4grid' }),
          ],
          verificationStatusMap: {},
        },
      });
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));

      // Today's scans[0]-only implementation would show only "600"/"2grid"
      // — both values must be visible for the fix to be correct.
      expect(screen.getByText(/600/)).toBeInTheDocument();
      expect(screen.getByText(/800/)).toBeInTheDocument();
      expect(screen.getByText(/2grid/)).toBeInTheDocument();
      expect(screen.getByText(/4grid/)).toBeInTheDocument();
      // Resolution AND grid_mode both differ here — each field gets its own
      // testid so a test asserting "which field is mixed" can't collide.
      expect(
        screen.getByTestId('mixed-value-indicator-resolution')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('mixed-value-indicator-grid-mode')
      ).toBeInTheDocument();
    });

    it('does not show a mixed-value indicator when every scan agrees on resolution/grid-mode', async () => {
      experimentDetail.mockResolvedValue({
        success: true,
        data: {
          scans: [makeScan(), makeScan({ id: 'scan-2' })],
          verificationStatusMap: {},
        },
      });
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));

      expect(
        screen.queryByTestId('mixed-value-indicator-resolution')
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('mixed-value-indicator-grid-mode')
      ).not.toBeInTheDocument();
    });

    it('caps a distinct-value list at 3 with "+N more" and a title attribute holding the full list', async () => {
      experimentDetail.mockResolvedValue({
        success: true,
        data: {
          scans: [
            makeScan({ resolution: 600 }),
            makeScan({ id: 's2', resolution: 800 }),
            makeScan({ id: 's3', resolution: 1200 }),
            makeScan({ id: 's4', resolution: 1600 }),
          ],
          verificationStatusMap: {},
        },
      });
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));

      const moreText = screen.getByText(/\+1 more/i);
      expect(moreText.closest('[title]')).toHaveAttribute(
        'title',
        expect.stringContaining('1600')
      );
    });
  });

  it('shows "experiment not found" without crashing for an unknown experimentId', async () => {
    experimentsGet.mockResolvedValue({
      success: false,
      error: 'Experiment not found: exp-404',
    });
    expect(() => renderPage('exp-404')).not.toThrow();
    await waitFor(() => {
      expect(screen.getByText(/experiment not found/i)).toBeInTheDocument();
    });
  });

  it('shows a friendly message on a generic experimentDetail error', async () => {
    experimentDetail.mockResolvedValue({
      success: false,
      error: 'DB connection lost',
    });
    expect(() => renderPage()).not.toThrow();
    await waitFor(() => {
      expect(screen.getByText(/DB connection lost/i)).toBeInTheDocument();
    });
  });

  describe('Linked Metadata', () => {
    it('lists existing links and unlinks after confirming', async () => {
      listGraviMetadata.mockResolvedValue({
        success: true,
        data: [
          {
            wave_number: 2,
            accession_id: 'acc-1',
            accession: { id: 'acc-1', name: 'batch3.xlsx' },
          },
        ],
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => {
        expect(screen.getByText(/wave 2: batch3\.xlsx/i)).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /unlink/i }));

      expect(confirmSpy).toHaveBeenCalled();
      expect(confirmSpy.mock.calls[0][0]).toMatch(/wave 2/i);
      await waitFor(() => {
        expect(unlinkGraviMetadata).toHaveBeenCalledWith('exp-1', 2);
      });
    });

    it('adds the extra confirmation sentence for wave 0', async () => {
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
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText(/wave 0: batch3\.xlsx/i));

      await user.click(screen.getByRole('button', { name: /unlink/i }));

      expect(confirmSpy.mock.calls[0][0]).toMatch(/default accession/i);
    });

    it('does not call unlinkGraviMetadata when the confirmation is declined', async () => {
      confirmSpy.mockReturnValue(false);
      listGraviMetadata.mockResolvedValue({
        success: true,
        data: [
          {
            wave_number: 1,
            accession_id: 'acc-1',
            accession: { id: 'acc-1', name: 'batch3.xlsx' },
          },
        ],
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText(/wave 1: batch3\.xlsx/i));

      await user.click(screen.getByRole('button', { name: /unlink/i }));

      expect(unlinkGraviMetadata).not.toHaveBeenCalled();
      expect(screen.getByText(/wave 1: batch3\.xlsx/i)).toBeInTheDocument();
    });

    it('links a new wave defaulting to suggestedNextWave, sourced from graviPlateAccessions.listFiles()', async () => {
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
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText(/wave 0: batch3\.xlsx/i));

      const waveInput = screen.getByLabelText(
        /new wave number/i
      ) as HTMLInputElement;
      expect(waveInput.value).toBe('1');

      const metadataSelect = screen.getByLabelText(/metadata file/i);
      await user.selectOptions(metadataSelect, 'acc-2');
      await user.click(screen.getByRole('button', { name: /^link$/i }));

      await waitFor(() => {
        expect(linkGraviMetadata).toHaveBeenCalledWith('exp-1', 1, 'acc-2');
      });
    });

    it('disables Link while a link call is in flight, so a rapid second click cannot fire a duplicate IPC call', async () => {
      let resolveLink: (v: { success: true }) => void;
      linkGraviMetadata.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveLink = resolve;
          })
      );
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(listFiles).toHaveBeenCalled());

      const metadataSelect = screen.getByLabelText(/metadata file/i);
      await user.selectOptions(metadataSelect, 'acc-2');
      const linkButton = screen.getByRole('button', { name: /^link$/i });
      await user.click(linkButton);

      expect(screen.getByRole('button', { name: /linking/i })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: /linking/i }));

      resolveLink!({ success: true });
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /^link$/i })
        ).not.toBeDisabled()
      );
      expect(linkGraviMetadata).toHaveBeenCalledTimes(1);
    });

    it('disables Unlink while an unlink call is in flight, so a rapid second click cannot fire a duplicate IPC call', async () => {
      let resolveUnlink: (v: { success: true }) => void;
      unlinkGraviMetadata.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveUnlink = resolve;
          })
      );
      listGraviMetadata.mockResolvedValue({
        success: true,
        data: [
          {
            wave_number: 1,
            accession_id: 'acc-1',
            accession: { id: 'acc-1', name: 'batch3.xlsx' },
          },
        ],
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText(/wave 1: batch3\.xlsx/i));

      const unlinkButton = screen.getByRole('button', { name: /^unlink$/i });
      await user.click(unlinkButton);

      expect(screen.getByRole('button', { name: /unlinking/i })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: /unlinking/i }));

      resolveUnlink!({ success: true });
      await waitFor(() => expect(unlinkGraviMetadata).toHaveBeenCalledTimes(1));
    });

    it('shows linkError inline on failure without clearing the form', async () => {
      linkGraviMetadata.mockResolvedValue({
        success: false,
        error: 'Wave already linked',
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(listFiles).toHaveBeenCalled());

      const metadataSelect = screen.getByLabelText(/metadata file/i);
      await user.selectOptions(metadataSelect, 'acc-2');
      await user.click(screen.getByRole('button', { name: /^link$/i }));

      await waitFor(() => {
        expect(screen.getByText(/wave already linked/i)).toBeInTheDocument();
      });
      expect(
        (screen.getByLabelText(/metadata file/i) as HTMLSelectElement).value
      ).toBe('acc-2');
    });
  });

  describe('File table', () => {
    it('uses the shared resize hook (no second inline drag implementation)', async () => {
      experimentDetail.mockResolvedValue({
        success: true,
        data: { scans: [makeScan()], verificationStatusMap: {} },
      });
      const addSpy = vi.spyOn(document, 'addEventListener');
      const { unmount } = renderPage();
      await waitFor(() => screen.getByText('Drought Study'));

      const handle = screen.getByTestId('resize-handle-filename');
      act(() => {
        handle.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, clientX: 0 })
        );
      });
      expect(addSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));

      const removeSpy = vi.spyOn(document, 'removeEventListener');
      expect(() => unmount()).not.toThrow();
      expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      addSpy.mockRestore();
      removeSpy.mockRestore();
    });

    it('shows the actual TIFF filename (basename of scan.path), not the database id', async () => {
      experimentDetail.mockResolvedValue({
        success: true,
        data: {
          scans: [makeScan({ path: '/scans/exp1_st_20260101_cy1_S1_00.tif' })],
          verificationStatusMap: {},
        },
      });
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));

      expect(
        screen.getByText('exp1_st_20260101_cy1_S1_00.tif')
      ).toBeInTheDocument();
      expect(screen.queryByText('scan-1')).not.toBeInTheDocument();
    });

    it('truncates a filename that overflows its column instead of letting it bleed into the Plate column, with the full name available via title', async () => {
      // Confirmed manually: a long filename rendered as e.g.
      // "00_1785956913481.tiff00" — the filename's overflow ran straight
      // into the Plate column's "00" with no visible separator at all.
      const longFilename = 'exp1_station_20260824_cy1_S1_wave0_00_full.tiff';
      experimentDetail.mockResolvedValue({
        success: true,
        data: {
          scans: [
            makeScan({ path: `/scans/${longFilename}`, plate_index: '07' }),
          ],
          verificationStatusMap: {},
        },
      });
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));

      const filenameCell = screen.getByTitle(longFilename);
      expect(filenameCell).toHaveClass('truncate');
      // The Plate value must be its own, separately-findable text node —
      // if the filename's overflow had swallowed it, this would fail.
      expect(screen.getByText('07')).toBeInTheDocument();
    });

    it('renders real Date objects (as returned by IPC, not strings) without throwing', async () => {
      // ipcRenderer.invoke's structured-clone preserves capture_date/
      // transplant_date as real Date instances, not the ISO strings other
      // tests in this file use as a shorthand — rendering a bare Date as a
      // JSX child throws, so this must go through formatDate().
      experimentDetail.mockResolvedValue({
        success: true,
        data: {
          scans: [
            makeScan({
              capture_date: new Date('2026-08-01T00:00:00.000Z'),
              transplant_date: new Date('2026-07-01T00:00:00.000Z'),
            }),
          ],
          verificationStatusMap: {},
        },
      });
      const user = userEvent.setup();
      expect(() => renderPage()).not.toThrow();
      await waitFor(() => screen.getByText('Drought Study'));

      await user.click(screen.getByTestId('file-row-scan-1'));

      expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
    });

    it('expands an inline TIFF preview and metadata fields on row click', async () => {
      experimentDetail.mockResolvedValue({
        success: true,
        data: { scans: [makeScan()], verificationStatusMap: {} },
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));

      await user.click(screen.getByTestId('file-row-scan-1'));

      await waitFor(() => {
        expect(readScanImage).toHaveBeenCalledWith(
          '/scans/scan-1.tiff',
          expect.anything()
        );
      });
      // Asserts the <img> itself renders with the resolved dataUri, not
      // just that the IPC call fired — a prior version of this test only
      // checked the latter, which didn't catch a double-wrapped IPC
      // envelope leaving dataUri undefined and the image never rendering.
      await waitFor(() => {
        expect(screen.getByAltText('scan-1')).toHaveAttribute(
          'src',
          'data:image/jpeg;base64,abc'
        );
      });
      expect(screen.getByText('BC-1')).toBeInTheDocument();
    });

    it('shows resolution and phenotyper name per scan in the expanded view (Decision 12) — the only way to tell which scan had which value once the summary shows an aggregate', async () => {
      experimentDetail.mockResolvedValue({
        success: true,
        data: {
          scans: [makeScan({ resolution: 800, phenotyper: { name: 'Carol' } })],
          verificationStatusMap: {},
        },
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));

      await user.click(screen.getByTestId('file-row-scan-1'));

      await waitFor(() => {
        // "800"/"Carol" also appear once in the summary strip's aggregate —
        // this asserts the per-scan expanded view ALSO shows them, not that
        // it's the only place they appear.
        expect(screen.getAllByText(/800/).length).toBeGreaterThanOrEqual(2);
        expect(screen.getAllByText(/carol/i).length).toBeGreaterThanOrEqual(2);
      });
    });

    it('shows a loading placeholder while readScanImage is in flight, then the image', async () => {
      let resolveRead: (v: unknown) => void = () => {};
      readScanImage.mockReturnValue(
        new Promise((resolve) => {
          resolveRead = resolve;
        })
      );
      experimentDetail.mockResolvedValue({
        success: true,
        data: { scans: [makeScan()], verificationStatusMap: {} },
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));

      await user.click(screen.getByTestId('file-row-scan-1'));
      expect(screen.getByText(/loading preview/i)).toBeInTheDocument();

      await act(async () => {
        resolveRead({
          success: true,
          dataUri: 'data:image/jpeg;base64,abc',
        });
      });
      await waitFor(() => {
        expect(screen.getByAltText('scan-1')).toBeInTheDocument();
      });
      expect(screen.queryByText(/loading preview/i)).not.toBeInTheDocument();
    });

    it('shows a failed-to-load message when readScanImage resolves {success: false}', async () => {
      readScanImage.mockResolvedValue({
        success: false,
        error: 'Path outside scan directory',
      });
      experimentDetail.mockResolvedValue({
        success: true,
        data: { scans: [makeScan()], verificationStatusMap: {} },
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));

      await user.click(screen.getByTestId('file-row-scan-1'));

      await waitFor(() => {
        expect(screen.getByText(/failed to load preview/i)).toBeInTheDocument();
      });
    });

    it('shows a "Needs Review" badge for needs_review status and a check for verified, no special styling otherwise', async () => {
      experimentDetail.mockResolvedValue({
        success: true,
        data: {
          scans: [
            makeScan({
              id: 'scan-a',
              scanner_id: 'scanner-1',
              plate_index: '00',
            }),
            makeScan({
              id: 'scan-b',
              scanner_id: 'scanner-1',
              plate_index: '01',
            }),
            makeScan({
              id: 'scan-c',
              scanner_id: 'scanner-1',
              plate_index: '02',
            }),
          ],
          verificationStatusMap: {
            'scanner-1:00': 'needs_review',
            'scanner-1:01': 'verified',
            'scanner-1:02': 'pending',
          },
        },
      });
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));

      expect(
        screen.getByTestId('verification-badge-scan-a').textContent
      ).toMatch(/needs review/i);
      expect(
        screen.getByTestId('verification-badge-scan-b').textContent
      ).toMatch(/✓|verified/i);
      expect(screen.getByTestId('verification-badge-scan-c').textContent).toBe(
        ''
      );
    });
  });

  describe('scanner/wave filter chips (Decision 12)', () => {
    it('shows a live count on each scanner chip, respecting the other active filter', async () => {
      experimentDetail.mockResolvedValue({
        success: true,
        data: {
          scans: [
            makeScan({ id: 's1', scanner_id: 'scanner-1', wave_number: 0 }),
            makeScan({ id: 's2', scanner_id: 'scanner-1', wave_number: 1 }),
            makeScan({ id: 's3', scanner_id: 'scanner-2', wave_number: 0 }),
          ],
          verificationStatusMap: {},
        },
      });
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));

      expect(
        screen.getByRole('button', { name: /scanner-1.*2/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /scanner-2.*1/i })
      ).toBeInTheDocument();
    });

    it('labels a scanner chip and the expanded-row "Scanner" field with the scanner\'s display_name/name — never the raw scanner_id', async () => {
      // Confirmed manually: with no scanner include, chips rendered raw
      // UUIDs like "1d51f773-cb96-4a77-808c-7c3ef95ad873" — meaningless to
      // an operator. `display_name` takes precedence over `name` per
      // `scannerLabel()`.
      const opaqueId = '1d51f773-cb96-4a77-808c-7c3ef95ad873';
      experimentDetail.mockResolvedValue({
        success: true,
        data: {
          scans: [
            makeScan({
              scanner_id: opaqueId,
              scanner: { name: 'gravi-01', display_name: 'Scanner X' },
            }),
          ],
          verificationStatusMap: {},
        },
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));

      expect(
        screen.getByRole('button', { name: /scanner x/i })
      ).toBeInTheDocument();
      expect(screen.queryByText(opaqueId)).not.toBeInTheDocument();

      await user.click(screen.getByTestId('file-row-scan-1'));
      await waitFor(() => {
        expect(screen.getByText('Scanner X')).toBeInTheDocument();
      });
      expect(screen.queryByText(opaqueId)).not.toBeInTheDocument();
    });

    it("falls back to the scanner's `name` when `display_name` is unset", async () => {
      experimentDetail.mockResolvedValue({
        success: true,
        data: {
          scans: [
            makeScan({
              scanner_id: 'scanner-x-id',
              scanner: { name: 'gravi-01', display_name: null },
            }),
          ],
          verificationStatusMap: {},
        },
      });
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));

      expect(
        screen.getByRole('button', { name: /gravi-01/i })
      ).toBeInTheDocument();
    });

    it('clicking an already-active scanner chip toggles it back off to "all"', async () => {
      experimentDetail.mockResolvedValue({
        success: true,
        data: {
          scans: [
            makeScan({ id: 's1', scanner_id: 'scanner-1' }),
            makeScan({ id: 's2', scanner_id: 'scanner-2' }),
          ],
          verificationStatusMap: {},
        },
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));

      const chip = screen.getByRole('button', { name: /scanner-1/i });
      await user.click(chip);
      expect(screen.queryByTestId('file-row-s2')).not.toBeInTheDocument();

      await user.click(chip);
      expect(screen.getByTestId('file-row-s2')).toBeInTheDocument();
    });

    it('shows "Showing X of Y" reflecting the current filter, and "No images match filters" when scanner+wave together match nothing', async () => {
      experimentDetail.mockResolvedValue({
        success: true,
        data: {
          scans: [
            makeScan({ id: 's1', scanner_id: 'scanner-1', wave_number: 0 }),
            makeScan({ id: 's2', scanner_id: 'scanner-2', wave_number: 1 }),
          ],
          verificationStatusMap: {},
        },
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText('Drought Study'));

      expect(screen.getByText(/showing 2 of 2/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /scanner-1/i }));
      expect(screen.getByText(/showing 1 of 2/i)).toBeInTheDocument();

      // scanner-1's only scan is wave 0 — selecting wave 1 alongside it
      // narrows the combination to zero matches.
      await user.click(screen.getByRole('button', { name: /^wave 1\b/i }));
      expect(screen.getByText(/no images match filters/i)).toBeInTheDocument();
    });
  });

  it('shows "Loading experiment..." during the initial fetch', async () => {
    let resolveDetail: (v: unknown) => void = () => {};
    experimentDetail.mockReturnValue(
      new Promise((resolve) => {
        resolveDetail = resolve;
      })
    );
    renderPage();

    await waitFor(() => screen.getByText('Drought Study'));
    expect(screen.getByText(/loading experiment/i)).toBeInTheDocument();

    await act(async () => {
      resolveDetail({
        success: true,
        data: { scans: [], verificationStatusMap: {} },
      });
    });
    await waitFor(() => {
      expect(screen.queryByText(/loading experiment/i)).not.toBeInTheDocument();
    });
  });
});
