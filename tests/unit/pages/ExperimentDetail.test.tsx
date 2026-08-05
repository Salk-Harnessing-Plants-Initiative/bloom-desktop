import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ExperimentDetail } from '../../../src/renderer/ExperimentDetail';

function makeScan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'scan-1',
    scanner_id: 'scanner-1',
    plate_index: '00',
    wave_number: 0,
    resolution: 600,
    grid_mode: '2grid',
    capture_date: '2026-08-01T00:00:00.000Z',
    transplant_date: '2026-07-01T00:00:00.000Z',
    custom_note: 'note',
    plate_barcode: 'BC-1',
    path: '/scans/scan-1.tiff',
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
      <MemoryRouter initialEntries={[`/graviscan-experiment/${experimentId}`]}>
        <Routes>
          <Route
            path="/graviscan-experiment/:experimentId"
            element={<ExperimentDetail />}
          />
        </Routes>
      </MemoryRouter>
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
      expect(screen.getByText('BC-1')).toBeInTheDocument();
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
});
