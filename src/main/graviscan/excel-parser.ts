/**
 * GraviScan Metadata Excel Parsing
 *
 * Runs in the main process, where exceljs's real `require()` calls work
 * natively. exceljs's own "browser" bundle (`dist/exceljs.min.js`) still
 * has an internal require() call that survives webpack bundling and
 * throws in Electron's sandboxed renderer — see PR #290 /
 * tier5-e2e-ci-mystery notes. Parsing here and sending plain data back to
 * the renderer over IPC sidesteps that class of bug entirely.
 */

import ExcelJS from 'exceljs';
import type { ParsedSheet, ParsedWorkbook } from '../../types/graviscan';

function parseWorksheet(worksheet: ExcelJS.Worksheet): ParsedSheet {
  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? '');
  });

  const rows: string[][] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: string[] = [];
    for (let i = 1; i <= headers.length; i++) {
      const cell = row.getCell(i);
      const value = cell.value;
      values[i - 1] =
        value instanceof Date
          ? value.toISOString().split('T')[0]
          : value !== null && value !== undefined
            ? String(value)
            : '';
    }
    rows.push(values);
  });

  return { headers, rows };
}

export async function parseExcelWorkbook(
  buffer: Buffer
): Promise<ParsedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's bundled type declarations predate the current @types/node's
  // generic Buffer<ArrayBufferLike> shape; structurally identical at
  // runtime, just not assignable under the newer types.
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]
  );

  const sheetNames = workbook.worksheets.map((ws) => ws.name);
  const sheets: Record<string, ParsedSheet> = {};
  for (const worksheet of workbook.worksheets) {
    sheets[worksheet.name] = parseWorksheet(worksheet);
  }

  return { sheetNames, sheets };
}
