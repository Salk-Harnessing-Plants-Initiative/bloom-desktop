import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { Experiments } from '../../../src/renderer/Experiments';
import { WaveMetadataLinksProvider } from '../../../src/renderer/contexts/WaveMetadataLinksContext';

/** Where a link took the page, for the tests that follow one. */
function Landed() {
  const location = useLocation();
  return <p data-testid="landed">{location.pathname + location.search}</p>;
}

function renderPage(mode: 'graviscan' | 'cylinderscan') {
  return render(
    <MemoryRouter initialEntries={['/experiments']}>
      <Routes>
        <Route
          path="/experiments"
          element={
            <WaveMetadataLinksProvider>
              <Experiments mode={mode} />
            </WaveMetadataLinksProvider>
          }
        />
        <Route path="*" element={<Landed />} />
      </Routes>
    </MemoryRouter>
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
  let latestScans: ReturnType<typeof vi.fn>;
  let listWaves: ReturnType<typeof vi.fn>;
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
    latestScans = vi.fn().mockResolvedValue({ success: true, data: [] });
    listWaves = vi.fn().mockResolvedValue({ success: true, data: [] });
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = global.window as any;
    win.electron.database.experiments = {
      list: listExperiments,
      latestScans,
      attachAccession,
      listGraviMetadata,
      linkGraviMetadata,
      unlinkGraviMetadata,
    };
    win.electron.database.graviPlateAccessions = { listFiles };
    win.electron.database.cylinderWaves = { list: listWaves };
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

  it('lists unscanned experiments first, then the most recently scanned, in the list and the attach picker', async () => {
    listExperiments.mockResolvedValue({
      success: true,
      data: [
        makeExperiment({ id: 'old', name: '2025-06-02 Soy drought' }),
        makeExperiment({ id: 'recent', name: '2026-11-10 STL Soy' }),
        makeExperiment({ id: 'new', name: 'Zinnia-W1' }),
      ],
    });
    latestScans.mockResolvedValue({
      success: true,
      data: [
        { experiment_id: 'old', latest_ms: Date.UTC(2025, 5, 2) },
        { experiment_id: 'recent', latest_ms: Date.UTC(2026, 10, 20) },
      ],
    });
    const { container } = renderPage('cylinderscan');
    await waitFor(() =>
      expect(
        container.querySelectorAll('ul.experiments-list > li')
      ).toHaveLength(3)
    );
    const names = [
      ...container.querySelectorAll('ul.experiments-list > li'),
    ].map((li) => li.textContent);
    expect(names).toEqual([
      expect.stringContaining('Zinnia-W1'),
      expect.stringContaining('2026-11-10 STL Soy'),
      expect.stringContaining('2025-06-02 Soy drought'),
    ]);
    const options = [
      ...(screen.getByLabelText(/Select Experiment/) as HTMLSelectElement)
        .options,
    ].map((o) => o.textContent);
    // Nothing is chosen until the user picks an experiment.
    expect(options[0]).toBe('-- Select an experiment --');
    expect(options[1]).toContain('Zinnia-W1');
    expect(options[2]).toContain('2026-11-10 STL Soy');
  });

  it('still lists experiments, by name, when the scan times cannot be loaded', async () => {
    listExperiments.mockResolvedValue({
      success: true,
      data: [
        makeExperiment({ id: 'b', name: 'Beta' }),
        makeExperiment({ id: 'a', name: 'Alpha' }),
      ],
    });
    latestScans.mockRejectedValue(new Error('database is locked'));
    const { container } = renderPage('cylinderscan');
    await waitFor(() =>
      expect(
        container.querySelectorAll('ul.experiments-list > li')
      ).toHaveLength(2)
    );
    expect(
      [...container.querySelectorAll('ul.experiments-list > li')].map(
        (li) => li.textContent
      )
    ).toEqual([
      expect.stringContaining('Alpha'),
      expect.stringContaining('Beta'),
    ]);
  });

  it("shows each experiment's accession file, or none, with wave dates only when asked", async () => {
    listExperiments.mockResolvedValue({
      success: true,
      data: [
        makeExperiment({ id: 'with', name: 'With file' }),
        makeExperiment({ id: 'without', name: 'No file', accession: null }),
      ],
    });
    renderPage('cylinderscan');
    expect(await screen.findByTestId('accession-file-with')).toHaveTextContent(
      'Accession file: Accession A'
    );
    expect(screen.getByTestId('accession-file-without')).toHaveTextContent(
      'Accession file: none'
    );
    expect(screen.queryByTestId('wave-dates-with')).not.toBeInTheDocument();
    expect(listWaves).not.toHaveBeenCalled();
  });

  it("opens and hides an experiment's wave dates and their history", async () => {
    listExperiments.mockResolvedValue({
      success: true,
      data: [
        makeExperiment({ id: 'with', name: 'With waves' }),
        makeExperiment({ id: 'empty', name: 'No waves', accession: null }),
      ],
    });
    listWaves.mockImplementation((id: string) =>
      Promise.resolve({
        success: true,
        data:
          id === 'with'
            ? [
                {
                  id: 'w1',
                  wave_number: 1,
                  dates_per_plant: false,
                  germination_date: '2026-11-01',
                  sowing_date: null,
                  transfer_date: null,
                  note: null,
                  set_by_name: 'Emily',
                  set_at: '2026-11-02T10:00:00.000Z',
                  scanCount: 3,
                  datedScanCount: 3,
                  changes: [],
                  plantsWithOwnDates: [],
                },
              ]
            : [],
      })
    );
    const user = userEvent.setup();
    renderPage('cylinderscan');
    // Each row's own toggle (unscanned rows are listed by name).
    const toggleOf = async (id: string) =>
      within(await screen.findByTestId(`accession-file-${id}`)).getByRole(
        'button'
      );

    await user.click(await toggleOf('with'));
    const panel = await screen.findByTestId('wave-dates-with');
    expect(panel).toHaveAttribute('open');
    expect(await toggleOf('with')).toHaveTextContent('Hide wave dates');
    expect(await toggleOf('with')).toHaveAttribute('aria-expanded', 'true');
    await user.click(await toggleOf('empty'));
    expect(await screen.findByText('No waves yet.')).toBeInTheDocument();

    await user.click(await toggleOf('with'));
    expect(screen.queryByTestId('wave-dates-with')).not.toBeInTheDocument();
  });

  it('shows the accession file as plain text where there is no Accessions page', async () => {
    listExperiments.mockResolvedValue({
      success: true,
      data: [makeExperiment({ id: 'with', name: 'Pilot experiment' })],
    });
    renderPage('graviscan');
    expect(await screen.findByTestId('accession-file-with')).toHaveTextContent(
      'Accession file: Accession A'
    );
    expect(
      screen.queryByRole('link', { name: 'Accession A' })
    ).not.toBeInTheDocument();
  });

  it('links the accession file to that file on the Accessions page', async () => {
    listExperiments.mockResolvedValue({
      success: true,
      data: [makeExperiment({ id: 'with', name: 'With file' })],
    });
    renderPage('cylinderscan');
    await userEvent.click(
      await screen.findByRole('link', { name: 'Accession A' })
    );
    expect(screen.getByTestId('landed')).toHaveTextContent(
      '/accessions?open=acc-1'
    );
  });

  it('explains when to attach an accession file to an existing experiment', async () => {
    renderPage('cylinderscan');
    expect(
      await screen.findByText(
        /add a corrected accession file to an experiment that\s+already exists, for example after its plants have been scanned/
      )
    ).toBeInTheDocument();
  });

  it('fills the spare height with the experiments box, which scrolls', async () => {
    listExperiments.mockResolvedValue({
      success: true,
      data: [makeExperiment()],
    });
    const { container } = renderPage('cylinderscan');
    await waitFor(() =>
      expect(container.querySelector('ul.experiments-list')).not.toBeNull()
    );
    expect(container.querySelector('ul.experiments-list')).toHaveClass(
      'flex-1',
      'overflow-auto'
    );
    expect(
      screen.queryByRole('button', { name: /^(expand|shrink)$/i })
    ).not.toBeInTheDocument();
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

    const attach = screen.getByRole('button', { name: /attach accession/i });
    expect(screen.queryByLabelText(/^wave number$/i)).not.toBeInTheDocument();

    // Nothing is pre-chosen, so Attach waits for both picks.
    expect(attach).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByLabelText(/Select Experiment/)).not.toBeDisabled()
    );
    await user.selectOptions(
      screen.getByLabelText(/Select Experiment/),
      'exp-1'
    );
    expect(attach).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByLabelText(/Select Accession File/)).not.toBeDisabled()
    );
    await user.selectOptions(
      screen.getByLabelText(/Select Accession File/),
      'acc-1'
    );

    await user.click(attach);
    await waitFor(() =>
      expect(attachAccession).toHaveBeenCalledWith('exp-1', 'acc-1')
    );
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
    await screen.findByRole('option', { name: /drought study/i });
    await user.selectOptions(
      screen.getByLabelText(/Select Experiment/),
      'exp-1'
    );
    expect(screen.getByTestId('attach-note')).toHaveTextContent(
      'link a metadata file to a wave of this GraviScan experiment'
    );

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
    await user.selectOptions(
      screen.getByLabelText(/Select Experiment/),
      'exp-1'
    );

    await user.selectOptions(screen.getByLabelText(/metadata file/i), 'gacc-1');
    await user.click(
      screen.getByRole('button', { name: /^(attach accession|link)$/i })
    );

    await waitFor(() => {
      // Rendered by both the attach panel and the row's own
      // ExperimentWaveLinks — expected now that they share state via
      // WaveMetadataLinksProvider (PR #290 / tier5-e2e-ci-mystery notes).
      expect(
        screen.getAllByText(/wave already linked/i).length
      ).toBeGreaterThan(0);
    });
    expect(screen.getByText(/wave 1: batch3\.xlsx/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/metadata file successfully linked/i)
    ).not.toBeInTheDocument();
  });

  it('surfaces a wave-metadata fetch error on the row even when that experiment has no links yet', async () => {
    // ExperimentWaveLinks early-returned null whenever links.length === 0
    // — which is indistinguishable from "no waves linked yet" (the
    // default state for every experiment before its first link) from
    // "the fetch that would tell us failed." That early return fired
    // BEFORE linkError was ever checked, so the most common trigger for
    // this failure (an experiment with nothing linked yet) silently
    // showed nothing at all on that row — not even the recourse message
    // this exact failure mode was given across several review rounds.
    //
    // Two experiments are used deliberately: failing the SECOND experiment's
    // fetch isolates the row-level component from the attach panel, which
    // renders its own linkError for whichever experiment it has chosen.
    listExperiments.mockResolvedValue({
      success: true,
      data: [
        makeExperiment({
          id: 'exp-1',
          name: 'Drought Study',
          experiment_type: 'graviscan',
        }),
        makeExperiment({
          id: 'exp-2',
          name: 'Salinity Study',
          experiment_type: 'graviscan',
        }),
      ],
    });
    listGraviMetadata.mockImplementation((experimentId: string) =>
      experimentId === 'exp-2'
        ? Promise.resolve({ success: false, error: 'Database is locked' })
        : Promise.resolve({ success: true, data: [] })
    );
    renderPage('graviscan');

    await waitFor(() => {
      expect(screen.getAllByText(/salinity study/i).length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(screen.getByText(/database is locked/i)).toBeInTheDocument();
    });
  });
});
