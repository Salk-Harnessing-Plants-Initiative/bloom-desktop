import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExcelJS from 'exceljs';
import { GraviMetadataUpload } from '../../../src/renderer/components/GraviMetadataUpload';
import { parseExcelWorkbook } from '../../../src/main/graviscan/excel-parser';

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

  it('disables Import while a submission is in flight and ignores a second click', async () => {
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

    // A second click while the first request is still in flight must not
    // fire a duplicate call — the button being disabled already prevents a
    // real click, but user-event still won't dispatch on a disabled
    // element, so this also documents the guard's intent.
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
