import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Experiments } from '../../../src/renderer/Experiments';
import { WaveMetadataLinksProvider } from '../../../src/renderer/contexts/WaveMetadataLinksContext';

function renderPage(mode: 'graviscan' | 'cylinderscan') {
  return render(
    <WaveMetadataLinksProvider>
      <Experiments mode={mode} />
    </WaveMetadataLinksProvider>
  );
}

function makeExperiment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exp-1',
    name: 'Drought Study',
    species: 'Alfalfa',
    experiment_type: 'cylinderscan',
    scientist: { name: 'Dr. Smith' },
    accession: { id: 'acc-1', name: 'Accession A' },
    ...overrides,
  };
}

describe('Experiments — wave-scoped metadata-link UI', () => {
  let listExperiments: ReturnType<typeof vi.fn>;
  let listGraviMetadata: ReturnType<typeof vi.fn>;
  let linkGraviMetadata: ReturnType<typeof vi.fn>;
  let unlinkGraviMetadata: ReturnType<typeof vi.fn>;
  let listFiles: ReturnType<typeof vi.fn>;
  let attachAccession: ReturnType<typeof vi.fn>;
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    listExperiments = vi.fn().mockResolvedValue({ success: true, data: [] });
    listGraviMetadata = vi.fn().mockResolvedValue({ success: true, data: [] });
    linkGraviMetadata = vi.fn().mockResolvedValue({ success: true });
    unlinkGraviMetadata = vi.fn().mockResolvedValue({ success: true });
    listFiles = vi.fn().mockResolvedValue({
      success: true,
      data: [{ id: 'gacc-1', name: 'batch3.xlsx' }],
    });
    attachAccession = vi.fn().mockResolvedValue({ success: true });
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = global.window as any;
    win.electron.database.experiments = {
      list: listExperiments,
      attachAccession,
      listGraviMetadata,
      linkGraviMetadata,
      unlinkGraviMetadata,
    };
    win.electron.database.graviPlateAccessions = { listFiles };
    win.electron.database.scientists = {
      list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    };
    win.electron.database.accessions = {
      list: vi.fn().mockResolvedValue({
        success: true,
        data: [{ id: 'acc-1', name: 'Accession A' }],
      }),
    };
  });

  it('shows linked waves inline for a graviscan experiment, with Unlink gated by confirm()', async () => {
    listExperiments.mockResolvedValue({
      success: true,
      data: [makeExperiment({ experiment_type: 'graviscan' })],
    });
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [
        {
          wave_number: 1,
          accession_id: 'gacc-1',
          accession: { id: 'gacc-1', name: 'batch3.xlsx' },
        },
      ],
    });
    const user = userEvent.setup();
    renderPage('graviscan');

    await waitFor(() => {
      expect(screen.getByText(/wave 1: batch3\.xlsx/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /unlink/i }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(unlinkGraviMetadata).toHaveBeenCalledWith('exp-1', 1);
    });
  });

  it('adds the extra confirmation sentence for wave 0', async () => {
    listExperiments.mockResolvedValue({
      success: true,
      data: [makeExperiment({ experiment_type: 'graviscan' })],
    });
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [
        {
          wave_number: 0,
          accession_id: 'gacc-1',
          accession: { id: 'gacc-1', name: 'batch3.xlsx' },
        },
      ],
    });
    const user = userEvent.setup();
    renderPage('graviscan');
    await waitFor(() => screen.getByText(/wave 0: batch3\.xlsx/i));

    await user.click(screen.getByRole('button', { name: /unlink/i }));

    expect(confirmSpy.mock.calls[0][0]).toMatch(/default accession/i);
  });

  it('cancelling the Unlink confirmation makes no IPC call', async () => {
    confirmSpy.mockReturnValue(false);
    listExperiments.mockResolvedValue({
      success: true,
      data: [makeExperiment({ experiment_type: 'graviscan' })],
    });
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [
        {
          wave_number: 1,
          accession_id: 'gacc-1',
          accession: { id: 'gacc-1', name: 'batch3.xlsx' },
        },
      ],
    });
    const user = userEvent.setup();
    renderPage('graviscan');
    await waitFor(() => screen.getByText(/wave 1: batch3\.xlsx/i));

    await user.click(screen.getByRole('button', { name: /unlink/i }));

    expect(unlinkGraviMetadata).not.toHaveBeenCalled();
  });

  it('disables Unlink while an unlink call is in flight, so a rapid second click cannot fire a duplicate IPC call', async () => {
    let resolveUnlink: (v: { success: true }) => void;
    unlinkGraviMetadata.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUnlink = resolve;
        })
    );
    listExperiments.mockResolvedValue({
      success: true,
      data: [makeExperiment({ experiment_type: 'graviscan' })],
    });
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [
        {
          wave_number: 1,
          accession_id: 'gacc-1',
          accession: { id: 'gacc-1', name: 'batch3.xlsx' },
        },
      ],
    });
    const user = userEvent.setup();
    renderPage('graviscan');
    await waitFor(() => screen.getByText(/wave 1: batch3\.xlsx/i));

    const unlinkButton = screen.getByRole('button', { name: /^unlink$/i });
    await user.click(unlinkButton);

    expect(screen.getByRole('button', { name: /unlinking/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /unlinking/i }));

    resolveUnlink!({ success: true });
    await waitFor(() => expect(unlinkGraviMetadata).toHaveBeenCalledTimes(1));
  });

  it('cylinderscan experiments keep the existing single-accession attachAccession flow', async () => {
    listExperiments.mockResolvedValue({
      success: true,
      data: [makeExperiment({ experiment_type: 'cylinderscan' })],
    });
    const user = userEvent.setup();
    renderPage('cylinderscan');
    await waitFor(() => expect(listExperiments).toHaveBeenCalled());

    expect(
      screen.getByRole('button', { name: /attach accession/i })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^wave number$/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /attach accession/i }));
    await waitFor(() => expect(attachAccession).toHaveBeenCalled());
    expect(linkGraviMetadata).not.toHaveBeenCalled();
  });

  it('selecting a graviscan experiment shows a wave-number field (defaulting to suggestedNextWave) and metadata-file select sourced from graviPlateAccessions.listFiles(), calling link()', async () => {
    listExperiments.mockResolvedValue({
      success: true,
      data: [makeExperiment({ experiment_type: 'graviscan' })],
    });
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [
        {
          wave_number: 0,
          accession_id: 'gacc-0',
          accession: { id: 'gacc-0', name: 'wave0.xlsx' },
        },
      ],
    });
    const user = userEvent.setup();
    renderPage('graviscan');
    await waitFor(() => expect(listFiles).toHaveBeenCalled());

    const waveInput = screen.getByLabelText(
      /^wave number to link$/i
    ) as HTMLInputElement;
    await waitFor(() => expect(waveInput.value).toBe('1'));

    await user.selectOptions(screen.getByLabelText(/metadata file/i), 'gacc-1');
    await user.click(
      screen.getByRole('button', { name: /^(attach accession|link)$/i })
    );

    await waitFor(() => {
      expect(linkGraviMetadata).toHaveBeenCalledWith('exp-1', 1, 'gacc-1');
    });
  });

  it('surfaces the backend rejection inline when linking an already-linked wave, without altering the existing link', async () => {
    listExperiments.mockResolvedValue({
      success: true,
      data: [makeExperiment({ experiment_type: 'graviscan' })],
    });
    listGraviMetadata.mockResolvedValue({
      success: true,
      data: [
        {
          wave_number: 1,
          accession_id: 'gacc-1',
          accession: { id: 'gacc-1', name: 'batch3.xlsx' },
        },
      ],
    });
    linkGraviMetadata.mockResolvedValue({
      success: false,
      error: 'Wave already linked',
    });
    const user = userEvent.setup();
    renderPage('graviscan');
    await waitFor(() => screen.getByText(/wave 1: batch3\.xlsx/i));
    await waitFor(() => expect(listFiles).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText(/metadata file/i), 'gacc-1');
    await user.click(
      screen.getByRole('button', { name: /^(attach accession|link)$/i })
    );

    await waitFor(() => {
      // Rendered by both the attach panel and the row's own
      // ExperimentWaveLinks — expected now that they share state via
      // WaveMetadataLinksProvider (PR #290 / tier5-e2e-ci-mystery notes).
      expect(screen.getAllByText(/wave already linked/i).length).toBeGreaterThan(
        0
      );
    });
    expect(screen.getByText(/wave 1: batch3\.xlsx/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/metadata file successfully linked/i)
    ).not.toBeInTheDocument();
  });
});
