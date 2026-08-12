// @vitest-environment node
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
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

async function buildWorkbookBuffer(
  sheets: Record<string, (string | number)[][]>
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    const sheet = workbook.addWorksheet(sheetName);
    sheet.addRow(HEADERS);
    rows.forEach((row) => sheet.addRow(row));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe('parseExcelWorkbook', () => {
  it('parses a single-sheet workbook into headers and string rows', async () => {
    const buffer = await buildWorkbookBuffer({
      Sheet1: [['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', 'note-a']],
    });

    const result = await parseExcelWorkbook(buffer);

    expect(result.sheetNames).toEqual(['Sheet1']);
    expect(result.sheets['Sheet1'].headers).toEqual(HEADERS);
    expect(result.sheets['Sheet1'].rows).toEqual([
      ['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', 'note-a'],
    ]);
  });

  it('parses every sheet in a multi-sheet workbook', async () => {
    const buffer = await buildWorkbookBuffer({
      'Batch A': [['P1', 'S1', 'QR1', 'Col-0', 'Soil', '2026-07-01', '']],
      'Batch B': [['P9', 'S9', 'QR9', 'Ler-0', 'Soil', '2026-07-02', '']],
    });

    const result = await parseExcelWorkbook(buffer);

    expect(result.sheetNames).toEqual(['Batch A', 'Batch B']);
    expect(result.sheets['Batch A'].rows[0][0]).toBe('P1');
    expect(result.sheets['Batch B'].rows[0][0]).toBe('P9');
  });

  it('returns an empty rows array for a sheet with only a header row', async () => {
    const buffer = await buildWorkbookBuffer({ Sheet1: [] });

    const result = await parseExcelWorkbook(buffer);

    expect(result.sheets['Sheet1'].rows).toEqual([]);
  });

  it('returns no sheets for a workbook with none', async () => {
    const workbook = new ExcelJS.Workbook();
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await parseExcelWorkbook(buffer);

    expect(result.sheetNames).toEqual([]);
    expect(result.sheets).toEqual({});
  });

  it('formats Date-valued cells as YYYY-MM-DD strings', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(HEADERS);
    sheet.addRow([
      'P1',
      'S1',
      'QR1',
      'Col-0',
      'Soil',
      new Date('2026-07-01T00:00:00Z'),
      '',
    ]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await parseExcelWorkbook(buffer);

    expect(result.sheets['Sheet1'].rows[0][5]).toBe('2026-07-01');
  });

  it('rejects a buffer that is not a valid xlsx file', async () => {
    const buffer = Buffer.from('not a spreadsheet');

    await expect(parseExcelWorkbook(buffer)).rejects.toThrow();
  });
});
