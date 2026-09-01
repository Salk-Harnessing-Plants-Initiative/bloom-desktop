import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { GraviMetadataUpload } from '../../../src/renderer/components/GraviMetadataUpload';
import { parseExcelWorkbook } from '../../../src/main/graviscan/excel-parser';
import {
  UnsavedChangesProvider,
  useUnsavedChanges,
} from '../../../src/renderer/contexts/UnsavedChangesContext';

function UnsavedChangesProbe() {
  const { hasUnsavedChanges } = useUnsavedChanges();
  return <div data-testid="unsaved-probe">{String(hasUnsavedChanges)}</div>;
}

const HEADERS = [
  'Plate ID',
  'Section ID',
  'Plant QR',
  'Accession',
  'Medium',
  'Transplant Date',
  'Custom Note',
];

async function buildWorkbookFile(
  rows: (string | number)[][],
  fileName = 'metadata.xlsx'
): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow(HEADERS);
  rows.forEach((row) => sheet.addRow(row));
  const buffer = await workbook.xlsx.writeBuffer();
  return new File([buffer], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

const SAMPLE_FIXTURE_PATH = path.join(
  __dirname,
  '../../fixtures/excel/graviscan-metadata-sample.xlsx'
);

function readSampleFixtureFile(): File {
  const buffer = fs.readFileSync(SAMPLE_FIXTURE_PATH);
  return new File([buffer], 'graviscan-metadata-sample.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('GraviMetadataUpload', () => {
  let createWithSections: ReturnType<typeof vi.fn>;
  let onUploadComplete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createWithSections = vi.fn().mockResolvedValue({
      success: true,
      data: { metadataFileId: 'file-1', totalPlates: 1 },
    });
    onUploadComplete = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = global.window as any;
    win.electron.database.graviPlateAccessions = { createWithSections };
    // The component now delegates parsing to the main process (exceljs's
    // browser bundle isn't actually renderer-safe — see excel-parser.ts).
    // Route the mocked IPC call through the real parser so these tests
    // still exercise real parsing behavior against real .xlsx buffers.
    win.electron.gravi = {
      parseExcelFile: vi.fn(async (buffer: ArrayBuffer) => {
        try {
          return {
            success: true,
            data: await parseExcelWorkbook(Buffer.from(buffer)),
          };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    };
  });

  function renderUpload() {
    return render(<GraviMetadataUpload onUploadComplete={onUploadComplete} />);
  }

  function renderUploadWithUnsavedProbe() {
    return render(
      <UnsavedChangesProvider>
        <UnsavedChangesProbe />
        <GraviMetadataUpload onUploadComplete={onUploadComplete} />
      </UnsavedChangesProvider>
    );
  }

  function getFileInput() {
    return screen.getByLabelText(/spreadsheet file/i) as HTMLInputElement;
  }

  it('rejects a non-.xlsx/.xls file before parsing', async () => {
    // applyAccept: false — bypasses user-event's browser-realistic accept
    // filtering so this test can verify the component's OWN validation
    // (defense-in-depth against a renamed file bypassing the input's
    // accept="" filter), not just the input attribute.
    const user = userEvent.setup({ applyAccept: false });
    renderUpload();
    const badFile = new File(['not a spreadsheet'], 'notes.txt', {
      type: 'text/plain',
    });
    await user.upload(getFileInput(), badFile);

    expect(
      screen.getByText(/must be an \.xlsx or \.xls file/i)
    ).toBeInTheDocument();
    expect(createWithSections).not.toHaveBeenCalled();
  });

  it('rejects a file over 15MB before parsing', async () => {
    const user = userEvent.setup();
    renderUpload();
    const bigFile = new File([new Uint8Array(16 * 1024 * 1024)], 'big.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await user.upload(getFileInput(), bigFile);

    expect(screen.getByText(/15\s*mb/i)).toBeInTheDocument();
    expect(createWithSections).not.toHaveBeenCalled();
  });

  it('prompts to choose a sheet for a multi-sheet file, and re-parses on change', async () => {
    const user = userEvent.setup();
    const workbook = new ExcelJS.Workbook();
    const sheet1 = workbook.addWorksheet('Batch A');
    sheet1.addRow(HEADERS);
    sheet1.addRow(['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', '']);
    const sheet2 = workbook.addWorksheet('Batch B');
    sheet2.addRow(HEADERS);
    sheet2.addRow(['P9', 'S9', 'QR9', 'Ler-0', 'Soil', '2026-07-02', '']);
    const buffer = await workbook.xlsx.writeBuffer();
    const file = new File([buffer], 'multi.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    renderUpload();
    await user.upload(getFileInput(), file);

    await waitFor(() => {
      expect(screen.getByLabelText(/^sheet$/i)).toBeInTheDocument();
    });
    expect(screen.getByText('P1')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^sheet$/i), 'Batch B');

    await waitFor(() => {
      expect(screen.getByText('P9')).toBeInTheDocument();
    });
    expect(screen.queryByText('P1')).not.toBeInTheDocument();
  });

  it('does not show a sheet selector for a single-sheet file', async () => {
    const user = userEvent.setup();
    const file = await buildWorkbookFile([
      ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
    ]);
    renderUpload();
    await user.upload(getFileInput(), file);

    await waitFor(() => screen.getByLabelText(/^plate id$/i));
    expect(screen.queryByLabelText(/^sheet$/i)).not.toBeInTheDocument();
  });

  it('shows column-mapping dropdowns after a valid file is parsed', async () => {
    const user = userEvent.setup();
    const file = await buildWorkbookFile([
      ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
    ]);
    renderUpload();

    await user.upload(getFileInput(), file);

    await waitFor(() => {
      expect(screen.getByLabelText(/^plate id$/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/^accession$/i)).toBeInTheDocument();
  });

  describe('color-coded preview columns (Decision 12, closes spec.md "Column mapping")', () => {
    it('applies a distinct visual class per mapped column role, not the same class for every column', async () => {
      const user = userEvent.setup();
      const file = await buildWorkbookFile([
        ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
      ]);
      renderUpload();

      await user.upload(getFileInput(), file);
      await waitFor(() => {
        expect(screen.getByTestId('preview-header-0')).toBeInTheDocument();
      });

      // HEADERS auto-maps column 0 -> Plate ID, column 1 -> Section ID —
      // two different field roles must carry two different marker classes,
      // not the same one applied uniformly.
      const plateIdHeader = screen.getByTestId('preview-header-0');
      const sectionIdHeader = screen.getByTestId('preview-header-1');
      expect(plateIdHeader.className).not.toBe('');
      expect(plateIdHeader.className).not.toBe(sectionIdHeader.className);
    });

    it('applies the same column-role class to the header and its body cells', async () => {
      const user = userEvent.setup();
      const file = await buildWorkbookFile([
        ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
      ]);
      renderUpload();

      await user.upload(getFileInput(), file);
      await waitFor(() => {
        expect(screen.getByTestId('preview-header-0')).toBeInTheDocument();
      });

      const header = screen.getByTestId('preview-header-0');
      const cell = screen.getByTestId('preview-cell-0-0');
      expect(cell.className).toBe(header.className);
    });

    it('applies no column-role class to an unmapped column', async () => {
      const user = userEvent.setup();
      // A file with an extra, unrecognized column that auto-mapping leaves
      // unmapped.
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.addRow([...HEADERS, 'Extra Column']);
      sheet.addRow(['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', '', 'x']);
      const buffer = await workbook.xlsx.writeBuffer();
      const file = new File([buffer], 'metadata.xlsx');
      renderUpload();

      await user.upload(getFileInput(), file);
      await waitFor(() => {
        expect(screen.getByTestId('preview-header-7')).toBeInTheDocument();
      });

      expect(screen.getByTestId('preview-header-7').className).toBe('');
    });
  });

  describe('Remove control and parsing-loading state', () => {
    it('shows a "Remove" control once a file is selected, which clears the selection', async () => {
      const user = userEvent.setup();
      const file = await buildWorkbookFile([
        ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
      ]);
      renderUpload();

      expect(
        screen.queryByRole('button', { name: /remove/i })
      ).not.toBeInTheDocument();

      await user.upload(getFileInput(), file);
      await waitFor(() => {
        expect(screen.getByLabelText(/^plate id$/i)).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /remove/i }));

      expect(screen.queryByLabelText(/^plate id$/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /remove/i })
      ).not.toBeInTheDocument();
    });

    it('shows a "Parsing file..." loading state while parseExcelFile is in flight', async () => {
      let resolveParse: (v: unknown) => void = () => {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = global.window as any;
      win.electron.gravi.parseExcelFile = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveParse = resolve;
          })
      );
      const user = userEvent.setup();
      const file = await buildWorkbookFile([
        ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
      ]);
      renderUpload();

      await user.upload(getFileInput(), file);
      await waitFor(() => {
        expect(screen.getByText(/parsing file/i)).toBeInTheDocument();
      });

      await waitFor(async () => {
        resolveParse({
          success: true,
          data: await parseExcelWorkbook(Buffer.from(await file.arrayBuffer())),
        });
      });
      await waitFor(() => {
        expect(screen.getByLabelText(/^plate id$/i)).toBeInTheDocument();
      });
      expect(screen.queryByText(/parsing file/i)).not.toBeInTheDocument();
    });
  });

  it('flags unsaved changes once a sheet is parsed, and clears them on unmount', async () => {
    const user = userEvent.setup();
    const file = await buildWorkbookFile([
      ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
    ]);
    const { rerender } = renderUploadWithUnsavedProbe();
    expect(screen.getByTestId('unsaved-probe')).toHaveTextContent('false');

    await user.upload(getFileInput(), file);
    await waitFor(() => {
      expect(screen.getByTestId('unsaved-probe')).toHaveTextContent('true');
    });

    // Re-render without GraviMetadataUpload (as a route change away from
    // Metadata would do) — its cleanup must not leave the flag stuck true
    // for whatever page comes next, still watched by the same probe.
    rerender(
      <UnsavedChangesProvider>
        <UnsavedChangesProbe />
      </UnsavedChangesProvider>
    );
    expect(screen.getByTestId('unsaved-probe')).toHaveTextContent('false');
  });

  it('clears the unsaved-changes flag once the import completes', async () => {
    const user = userEvent.setup();
    const file = await buildWorkbookFile([
      ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
    ]);
    renderUploadWithUnsavedProbe();
    await user.upload(getFileInput(), file);
    await waitFor(() => {
      expect(screen.getByTestId('unsaved-probe')).toHaveTextContent('true');
    });

    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-probe')).toHaveTextContent('false');
    });
  });

  it('rejects a valid-type file whose sheet has zero data rows', async () => {
    const user = userEvent.setup();
    const file = await buildWorkbookFile([]);
    renderUpload();

    await user.upload(getFileInput(), file);

    await waitFor(() => {
      expect(screen.getByText(/no data to import/i)).toBeInTheDocument();
    });
    expect(createWithSections).not.toHaveBeenCalled();
  });

  it('flags a partial row (some but not all required cells filled) as a validation error and blocks submission', async () => {
    const user = userEvent.setup();
    const file = await buildWorkbookFile([
      ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
      ['P2', '', 'QR2', 'Col-0', '', '', ''], // missing Section ID, Medium, Transplant Date
    ]);
    renderUpload();
    await user.upload(getFileInput(), file);
    await waitFor(() => screen.getByLabelText(/^plate id$/i));

    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      // Row numbering matches the spreadsheet's real row numbers (header is
      // row 1, so the second data row — the invalid "P2" row — is row 3).
      expect(screen.getByText(/row 3/i)).toBeInTheDocument();
    });
    expect(createWithSections).not.toHaveBeenCalled();
  });

  describe('pre-submit metadata validation (closes #207, #313)', () => {
    it('blocks submission and names the outlier when plate IDs use inconsistent numeric padding', async () => {
      const user = userEvent.setup();
      const file = await buildWorkbookFile([
        ['P01', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
        ['P02', 'S1', 'QR2', 'Col-0', 'Soil', '2026-07-01', ''],
        ['P003', 'S1', 'QR3', 'Col-0', 'Soil', '2026-07-01', ''],
      ]);
      renderUpload();
      await user.upload(getFileInput(), file);
      await waitFor(() => screen.getByLabelText(/^plate id$/i));

      await user.click(screen.getByRole('button', { name: /^import$/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/padding/i, { selector: 'li' })
        ).toBeInTheDocument();
      });
      expect(screen.getByText(/P003/, { selector: 'li' })).toBeInTheDocument();
      expect(createWithSections).not.toHaveBeenCalled();
    });

    it('blocks submission when the same plant QR appears on two different plates', async () => {
      const user = userEvent.setup();
      const file = await buildWorkbookFile([
        ['P1', 'S1', 'DUPLICATE-QR', 'Col-0', 'Soil', '2026-07-01', ''],
        ['P2', 'S1', 'DUPLICATE-QR', 'Col-0', 'Soil', '2026-07-01', ''],
      ]);
      renderUpload();
      await user.upload(getFileInput(), file);
      await waitFor(() => screen.getByLabelText(/^plate id$/i));

      await user.click(screen.getByRole('button', { name: /^import$/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/DUPLICATE-QR/, { selector: 'li' })
        ).toBeInTheDocument();
      });
      expect(createWithSections).not.toHaveBeenCalled();
    });

    it('blocks submission when a plate has inconsistent accession values across its sections', async () => {
      const user = userEvent.setup();
      const file = await buildWorkbookFile([
        ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
        ['P1', 'S2', 'QR2', 'Ler-0', 'Soil', '2026-07-01', ''],
      ]);
      renderUpload();
      await user.upload(getFileInput(), file);
      await waitFor(() => screen.getByLabelText(/^plate id$/i));

      await user.click(screen.getByRole('button', { name: /^import$/i }));

      await waitFor(() => {
        expect(screen.getByText(/inconsistent accession/i)).toBeInTheDocument();
      });
      expect(createWithSections).not.toHaveBeenCalled();
    });

    it('allows a valid, consistently-formatted file through unchanged', async () => {
      const user = userEvent.setup();
      const file = await buildWorkbookFile([
        ['P001', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
        ['P002', 'S1', 'QR2', 'Col-0', 'Soil', '2026-07-01', ''],
      ]);
      renderUpload();
      await user.upload(getFileInput(), file);
      await waitFor(() => screen.getByLabelText(/^plate id$/i));

      await user.click(screen.getByRole('button', { name: /^import$/i }));

      await waitFor(() => {
        expect(createWithSections).toHaveBeenCalledTimes(1);
      });
    });

    describe('column-mapping collision (closes #353)', () => {
      it('blocks submission when two fields are mapped to the same column, naming both and the column', async () => {
        const user = userEvent.setup();
        const file = await buildWorkbookFile([
          ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
        ]);
        renderUpload();
        await user.upload(getFileInput(), file);
        await waitFor(() => screen.getByLabelText(/^plate id$/i));

        // HEADERS auto-maps "Section ID" to column 1 (its own column);
        // re-point it at column 0, the same column "Plate ID" is mapped to.
        await user.selectOptions(screen.getByLabelText(/^section id$/i), '0');

        await user.click(screen.getByRole('button', { name: /^import$/i }));

        await waitFor(() => {
          expect(
            screen.getByText(/plate id/i, { selector: 'li' })
          ).toBeInTheDocument();
        });
        const message = screen.getByText(/plate id/i, {
          selector: 'li',
        }).textContent;
        expect(message).toMatch(/section id/i);
        expect(message).toMatch(/column/i);
        expect(createWithSections).not.toHaveBeenCalled();
      });

      it('blocks submission when the optional Custom Note field collides with a required field', async () => {
        const user = userEvent.setup();
        const file = await buildWorkbookFile([
          ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', 'a note'],
        ]);
        renderUpload();
        await user.upload(getFileInput(), file);
        await waitFor(() => screen.getByLabelText(/^plate id$/i));

        // "Medium" auto-maps to column 4; re-point "Custom Note" (column 6)
        // at that same column.
        await user.selectOptions(screen.getByLabelText(/^custom note$/i), '4');

        await user.click(screen.getByRole('button', { name: /^import$/i }));

        await waitFor(() => {
          expect(
            screen.getByText(/medium/i, { selector: 'li' })
          ).toBeInTheDocument();
        });
        const message = screen.getByText(/medium/i, {
          selector: 'li',
        }).textContent;
        expect(message).toMatch(/custom note/i);
        expect(createWithSections).not.toHaveBeenCalled();
      });

      it('reports a three-way collision as a single message naming all three fields, not three pairwise messages', async () => {
        const user = userEvent.setup();
        const file = await buildWorkbookFile([
          ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
        ]);
        renderUpload();
        await user.upload(getFileInput(), file);
        await waitFor(() => screen.getByLabelText(/^plate id$/i));

        // Re-point both "Section ID" and "Accession" at column 0, so three
        // fields (Plate ID, Section ID, Accession) all claim the same column.
        await user.selectOptions(screen.getByLabelText(/^section id$/i), '0');
        await user.selectOptions(screen.getByLabelText(/^accession$/i), '0');

        await user.click(screen.getByRole('button', { name: /^import$/i }));

        await waitFor(() => {
          expect(screen.getAllByRole('listitem')).toHaveLength(1);
        });
        const message = screen.getAllByRole('listitem')[0].textContent;
        expect(message).toMatch(/plate id/i);
        expect(message).toMatch(/section id/i);
        expect(message).toMatch(/accession/i);
        expect(createWithSections).not.toHaveBeenCalled();
      });

      it('reports two independent collisions as two separate messages', async () => {
        const user = userEvent.setup();
        const file = await buildWorkbookFile([
          ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
        ]);
        renderUpload();
        await user.upload(getFileInput(), file);
        await waitFor(() => screen.getByLabelText(/^plate id$/i));

        // Two unrelated collisions: Section ID -> Plate ID's column (0), and
        // Custom Note -> Medium's column (4).
        await user.selectOptions(screen.getByLabelText(/^section id$/i), '0');
        await user.selectOptions(screen.getByLabelText(/^custom note$/i), '4');

        await user.click(screen.getByRole('button', { name: /^import$/i }));

        await waitFor(() => {
          expect(screen.getAllByRole('listitem')).toHaveLength(2);
        });
        const messages = screen
          .getAllByRole('listitem')
          .map((li) => li.textContent ?? '');
        expect(
          messages.some((m) => /plate id/i.test(m) && /section id/i.test(m))
        ).toBe(true);
        expect(
          messages.some((m) => /medium/i.test(m) && /custom note/i.test(m))
        ).toBe(true);
        expect(createWithSections).not.toHaveBeenCalled();
      });

      it('shows only the collision error, not a mix of collision and partial-row messages, when a mapping collision coincides with a row that would also fail partial-row validation', async () => {
        const user = userEvent.setup();
        const file = await buildWorkbookFile([
          ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
          ['P2', '', 'QR2', 'Col-0', '', '', ''], // would fail partial-row validation on its own
        ]);
        renderUpload();
        await user.upload(getFileInput(), file);
        await waitFor(() => screen.getByLabelText(/^plate id$/i));

        await user.selectOptions(screen.getByLabelText(/^section id$/i), '0');

        await user.click(screen.getByRole('button', { name: /^import$/i }));

        await waitFor(() => {
          expect(
            screen.getByText(/plate id/i, { selector: 'li' })
          ).toBeInTheDocument();
        });
        expect(
          screen.queryByText(/some required fields are blank/i)
        ).not.toBeInTheDocument();
        expect(createWithSections).not.toHaveBeenCalled();
      });

      it('does not treat several never-mapped fields as colliding with each other', async () => {
        // A spreadsheet whose headers don't match any field name exactly, so
        // every field stays unmapped (mapping = {}, i.e. every value is
        // undefined, not ''). If the collision check only excluded explicit
        // '' and not undefined, every unmapped field would appear to
        // collide with every other one.
        createWithSections.mockResolvedValue({
          success: false,
          error:
            'No plates found — check that every required column is mapped correctly',
        });
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Sheet1');
        sheet.addRow(['ColA', 'ColB', 'ColC', 'ColD', 'ColE', 'ColF', 'ColG']);
        sheet.addRow(['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', '']);
        const buffer = await workbook.xlsx.writeBuffer();
        const file = new File([buffer], 'metadata.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const user = userEvent.setup();
        renderUpload();
        await user.upload(getFileInput(), file);
        await waitFor(() => screen.getByLabelText(/^plate id$/i));

        await user.click(screen.getByRole('button', { name: /^import$/i }));

        await waitFor(() => {
          expect(screen.getByText(/no plates found/i)).toBeInTheDocument();
        });
        expect(
          screen.queryByText(/mapped to the same column/i)
        ).not.toBeInTheDocument();
      });

      it("clearing an already-mapped required field back to unmapped blocks import with a validation error, instead of silently reusing another column's data", async () => {
        // Regression test for a bug in the pre-existing `colIndex` helper
        // (unrelated to findMappingCollisions itself, but exercised by the
        // same "explicitly cleared to ''" input this PR's collision check
        // relies on being treated as unmapped): `colIndex` used
        // `mapping[field] !== undefined` to distinguish mapped from
        // unmapped, but an explicitly-cleared field's value is the string
        // '', which IS !== undefined, so `Number('')` resolved to column 0
        // — silently reusing column 0's data (here, Plate ID's) as if it
        // were the cleared field's own value, with no error at all. This
        // is exactly the silent-corruption class of bug #353 was filed to
        // close, just reached through a different interaction than the
        // mapping-collision path.
        const user = userEvent.setup();
        const file = await buildWorkbookFile([
          ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
        ]);
        renderUpload();
        await user.upload(getFileInput(), file);
        await waitFor(() => screen.getByLabelText(/^plate id$/i));

        await user.selectOptions(screen.getByLabelText(/^medium$/i), '');

        await user.click(screen.getByRole('button', { name: /^import$/i }));

        await waitFor(() => {
          expect(screen.getByText(/row 2/i)).toBeInTheDocument();
        });
        expect(
          screen.getByText(/some required fields are blank/i)
        ).toBeInTheDocument();
        expect(createWithSections).not.toHaveBeenCalled();
      });

      it("clearing an already-mapped optional field back to unmapped imports it as genuinely blank, not another column's data", async () => {
        const user = userEvent.setup();
        const file = await buildWorkbookFile([
          ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', 'a note'],
        ]);
        renderUpload();
        await user.upload(getFileInput(), file);
        await waitFor(() => screen.getByLabelText(/^plate id$/i));

        await user.selectOptions(screen.getByLabelText(/^custom note$/i), '');

        await user.click(screen.getByRole('button', { name: /^import$/i }));

        await waitFor(() => {
          expect(createWithSections).toHaveBeenCalledTimes(1);
        });
        const [, plates] = createWithSections.mock.calls[0];
        expect(plates[0].custom_note).toBe('');
      });

      it('clearing two already-mapped required fields at once does not falsely report them as colliding, and blocks with a partial-row error instead', async () => {
        const user = userEvent.setup();
        const file = await buildWorkbookFile([
          ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
        ]);
        renderUpload();
        await user.upload(getFileInput(), file);
        await waitFor(() => screen.getByLabelText(/^plate id$/i));

        await user.selectOptions(screen.getByLabelText(/^section id$/i), '');
        await user.selectOptions(screen.getByLabelText(/^medium$/i), '');

        await user.click(screen.getByRole('button', { name: /^import$/i }));

        await waitFor(() => {
          expect(screen.getByText(/row 2/i)).toBeInTheDocument();
        });
        expect(
          screen.getByText(/some required fields are blank/i)
        ).toBeInTheDocument();
        expect(
          screen.queryByText(/mapped to the same column/i)
        ).not.toBeInTheDocument();
        expect(createWithSections).not.toHaveBeenCalled();
      });

      it('disambiguates a collision on a blank-header column by position, since header text alone is unavailable', async () => {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Sheet1');
        sheet.addRow([
          'Plate ID',
          '',
          'Plant QR',
          'Accession',
          'Medium',
          'Transplant Date',
          'Custom Note',
        ]);
        sheet.addRow(['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', '']);
        const buffer = await workbook.xlsx.writeBuffer();
        const file = new File([buffer], 'metadata.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const user = userEvent.setup();
        renderUpload();
        await user.upload(getFileInput(), file);
        await waitFor(() => screen.getByLabelText(/^plate id$/i));

        // Column index 1 has a blank header, so nothing auto-maps to it by
        // name — map both "Section ID" and "Custom Note" there explicitly
        // to force a collision on that blank-header column.
        await user.selectOptions(screen.getByLabelText(/^section id$/i), '1');
        await user.selectOptions(screen.getByLabelText(/^custom note$/i), '1');

        await user.click(screen.getByRole('button', { name: /^import$/i }));

        await waitFor(() => {
          expect(
            screen.getByText(/section id/i, { selector: 'li' })
          ).toBeInTheDocument();
        });
        const message = screen.getByText(/section id/i, {
          selector: 'li',
        }).textContent;
        expect(message).toMatch(/custom note/i);
        expect(message).toMatch(/column 2/i);
        // Pin the branch, not just a substring match: a blank header must
        // produce "column 2" alone, not "column 2, header ''" — asserting
        // the header clause is entirely absent (not merely empty) is what
        // actually distinguishes this from the header-present branch.
        expect(message).not.toMatch(/header/i);
        expect(createWithSections).not.toHaveBeenCalled();
      });
    });
  });

  it('warns how many rows were skipped when a row has no data in any required field', async () => {
    // A row where every required field is blank doesn't trigger the
    // partial-row validation error (filled === 0, not 0 < filled <
    // required.length) — it's silently excluded downstream by the
    // plate-grouping loop's `if (!plateId) continue`. That's the right
    // behavior for e.g. a trailing blank Excel row, but the operator
    // previously had no way to know rows were dropped at all.
    const user = userEvent.setup();
    const file = await buildWorkbookFile([
      ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
      ['', '', '', '', '', '', ''],
    ]);
    renderUpload();
    await user.upload(getFileInput(), file);
    await waitFor(() => screen.getByLabelText(/^plate id$/i));

    expect(screen.getByText(/1 row.*skipped/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(createWithSections).toHaveBeenCalledTimes(1);
    });
    const [, plates] = createWithSections.mock.calls[0];
    expect(plates).toHaveLength(1);
  });

  it('treats a whitespace-only row the same as a fully blank one — skipped, not imported as a blank plate', async () => {
    // blankRowCount (shown to the operator) detects blank rows via
    // `.trim() === ''`, but the plate-grouping loop below previously
    // checked `if (!plateId) continue` — a whitespace-only Plate ID (' ')
    // is truthy, so the row was silently imported as a real plate with a
    // blank/whitespace plate_id, contradicting the "will be skipped"
    // warning the operator just saw.
    const user = userEvent.setup();
    const file = await buildWorkbookFile([
      ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
      [' ', ' ', ' ', ' ', ' ', ' ', ''],
    ]);
    renderUpload();
    await user.upload(getFileInput(), file);
    await waitFor(() => screen.getByLabelText(/^plate id$/i));

    expect(screen.getByText(/1 row.*skipped/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(createWithSections).toHaveBeenCalledTimes(1);
    });
    const [, plates] = createWithSections.mock.calls[0];
    expect(plates).toHaveLength(1);
    expect(plates[0].plate_id).toBe('P1');
  });

  it('surfaces the backend "no plates found" error instead of a false success when every row is blank', async () => {
    // If literally every data row is blank (e.g. an operator uploads a
    // template with headers only), the plate-grouping loop excludes all of
    // them and would call createWithSections with an empty plates array.
    // database-handlers.ts's graviPlateAccessionsCreateWithSections already
    // rejects that with a clear error (round 1, task 15.3) — this just
    // confirms the renderer's existing error path surfaces it correctly
    // rather than silently reporting a no-op import as a success.
    createWithSections.mockResolvedValue({
      success: false,
      error:
        'No plates found — check that every required column is mapped correctly',
    });
    const user = userEvent.setup();
    const file = await buildWorkbookFile([
      ['', '', '', '', '', '', ''],
      ['', '', '', '', '', '', ''],
    ]);
    renderUpload();
    await user.upload(getFileInput(), file);
    await waitFor(() => screen.getByLabelText(/^plate id$/i));

    expect(screen.getByText(/2 rows.*skipped/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(screen.getByText(/no plates found/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/done uploading/i)).not.toBeInTheDocument();
    const [, plates] = createWithSections.mock.calls[0];
    expect(plates).toHaveLength(0);
  });

  it('clears a stale top-level error from a prior failed attempt when the next attempt is blocked by a mapping collision', async () => {
    createWithSections.mockResolvedValue({
      success: false,
      error: 'Failed to import metadata',
    });
    const user = userEvent.setup();
    const file = await buildWorkbookFile([
      ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
    ]);
    renderUpload();
    await user.upload(getFileInput(), file);
    await waitFor(() => screen.getByLabelText(/^plate id$/i));

    await user.click(screen.getByRole('button', { name: /^import$/i }));
    await waitFor(() => {
      expect(screen.getByText('Failed to import metadata')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText(/^section id$/i), '0');
    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/plate id/i, { selector: 'li' })
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText('Failed to import metadata')
    ).not.toBeInTheDocument();
  });

  it('surfaces an error instead of a false "Done uploading!" when no column headers auto-map', async () => {
    // Simulates a spreadsheet whose headers don't exactly match the
    // expected field names (e.g. "PlateID" instead of "Plate ID") and
    // where the operator never manually fixed the mapping: every
    // required field stays unmapped, so every row's plate_id resolves to
    // '' and is silently skipped, producing an empty plates array.
    createWithSections.mockResolvedValue({
      success: false,
      error:
        'No plates found — check that every required column is mapped correctly',
    });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow([
      'PlateID',
      'SectionID',
      'PlantQR',
      'AccessionName',
      'GrowthMedium',
      'TransplantDate',
    ]);
    sheet.addRow(['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01']);
    const buffer = await workbook.xlsx.writeBuffer();
    const file = new File([buffer], 'metadata.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const user = userEvent.setup();
    renderUpload();
    await user.upload(getFileInput(), file);
    await waitFor(() => screen.getByLabelText(/^plate id$/i));

    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(screen.getByText(/no plates found/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/done uploading/i)).not.toBeInTheDocument();
  });

  it('groups rows by Plate ID and calls createWithSections on a fully valid file', async () => {
    const user = userEvent.setup();
    const file = await buildWorkbookFile([
      ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', 'note-a'],
      ['P1', 'S2', 'QR2', 'Col-0', 'Soil', '2026-07-01', ''],
      ['P2', 'S3', 'QR3', 'Ler-0', 'Soil', '2026-07-02', ''],
    ]);
    renderUpload();
    await user.upload(getFileInput(), file);
    await waitFor(() => screen.getByLabelText(/^plate id$/i));

    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(createWithSections).toHaveBeenCalledTimes(1);
    });
    const [, plates] = createWithSections.mock.calls[0];
    expect(plates).toHaveLength(2);
    const p1 = plates.find((p: { plate_id: string }) => p.plate_id === 'P1');
    expect(p1.sections).toHaveLength(2);
  });

  it('imports the checked-in graviscan-metadata-sample.xlsx fixture end to end — guards against the committed sample going stale', async () => {
    // This fixture (tests/fixtures/excel/graviscan-metadata-sample.xlsx) is
    // handed to users for manual Metadata-page testing — nothing else in
    // this file reads a real file from disk (every other test builds an
    // in-memory workbook), so without this test the committed sample could
    // silently drift out of sync with the real required-column schema and
    // nothing would catch it.
    const user = userEvent.setup();
    const file = readSampleFixtureFile();
    renderUpload();

    await user.upload(getFileInput(), file);

    // All 7 columns (6 required + Custom Note) must auto-map by exact
    // header-name match — if the fixture's headers ever drift from
    // REQUIRED_FIELDS/OPTIONAL_FIELDS, this fails here before the plate
    // assertions below even run.
    await waitFor(() => {
      expect(
        (screen.getByLabelText(/^plate id$/i) as HTMLSelectElement).value
      ).not.toBe('');
    });
    for (const field of [
      'section id',
      'plant qr',
      'accession',
      'medium',
      'transplant date',
      'custom note',
    ]) {
      expect(
        (
          screen.getByLabelText(
            new RegExp(`^${field}$`, 'i')
          ) as HTMLSelectElement
        ).value
      ).not.toBe('');
    }

    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(createWithSections).toHaveBeenCalledTimes(1);
    });
    const [fileMeta, plates] = createWithSections.mock.calls[0];
    expect(fileMeta).toEqual({ name: 'graviscan-metadata-sample.xlsx' });
    expect(plates).toHaveLength(4);
    for (const plate of plates) {
      expect(plate.sections).toHaveLength(4);
    }
    const p4 = plates.find((p: { plate_id: string }) => p.plate_id === 'P4');
    expect(p4.accession).toBe('ACC-drought-B');
    // P4's Custom Note is deliberately blank in the fixture, to exercise
    // that the optional field being empty doesn't block import.
    expect(p4.custom_note).toBe('');
  });

  it('disables the Import button while a submission is in flight, preventing a duplicate click', async () => {
    let resolveCreate: (value: unknown) => void = () => {};
    createWithSections.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      })
    );
    const user = userEvent.setup();
    const file = await buildWorkbookFile([
      ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
    ]);
    renderUpload();
    await user.upload(getFileInput(), file);
    await waitFor(() => screen.getByLabelText(/^plate id$/i));

    const importButton = screen.getByRole('button', { name: /^import$/i });
    await user.click(importButton);
    expect(importButton).toBeDisabled();

    // user-event won't dispatch a click on a disabled element at all
    // (matching real browser behavior), so this only proves the disabled
    // attribute itself is what prevents the duplicate IPC call — it does
    // not exercise handleImport's own `isImporting` re-entrancy guard,
    // which is unreachable through the DOM given the button is the
    // feature's only entry point. That guard is defense-in-depth, not
    // independently covered by a test.
    await user.click(importButton);
    expect(createWithSections).toHaveBeenCalledTimes(1);

    resolveCreate({
      success: true,
      data: { metadataFileId: 'file-1', totalPlates: 1 },
    });
    await waitFor(() => {
      expect(screen.getByText(/done uploading/i)).toBeInTheDocument();
    });
  });

  it('shows a completion message, resets, and calls onUploadComplete on success', async () => {
    const user = userEvent.setup();
    const file = await buildWorkbookFile([
      ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', ''],
    ]);
    renderUpload();
    await user.upload(getFileInput(), file);
    await waitFor(() => screen.getByLabelText(/^plate id$/i));

    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(screen.getByText(/done uploading/i)).toBeInTheDocument();
    });
    await waitFor(
      () => {
        expect(onUploadComplete).toHaveBeenCalled();
      },
      { timeout: 3000 }
    );
  });
});
