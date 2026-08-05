import { useState } from 'react';
import ExcelJS from 'exceljs';

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const PREVIEW_ROW_LIMIT = 20;

const REQUIRED_FIELDS = [
  'Plate ID',
  'Section ID',
  'Plant QR',
  'Accession',
  'Medium',
  'Transplant Date',
] as const;
const OPTIONAL_FIELDS = ['Custom Note'] as const;
const ALL_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

interface ParsedSheet {
  headers: string[];
  rows: string[][];
}

interface GraviMetadataUploadProps {
  onUploadComplete: () => void;
}

function guessMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const field of ALL_FIELDS) {
    const idx = headers.findIndex(
      (h) => h.trim().toLowerCase() === field.toLowerCase()
    );
    if (idx !== -1) mapping[field] = String(idx);
  }
  return mapping;
}

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

export function GraviMetadataUpload({
  onUploadComplete,
}: GraviMetadataUploadProps) {
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<string[]>([]);
  const [workbook, setWorkbook] = useState<ExcelJS.Workbook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState<string>('');
  const [done, setDone] = useState(false);

  const reset = () => {
    setWorkbook(null);
    setSheetNames([]);
    setSelectedSheet('');
    setSheet(null);
    setMapping({});
    setFileName('');
    setError(null);
    setRowErrors([]);
  };

  const loadSheet = (wb: ExcelJS.Workbook, sheetName: string): boolean => {
    const worksheet = wb.getWorksheet(sheetName);
    if (!worksheet) return false;
    const parsed = parseWorksheet(worksheet);
    if (parsed.rows.length === 0) {
      setError('No data to import — the sheet has no data rows');
      setSheet(null);
      return false;
    }
    setError(null);
    setSheet(parsed);
    setMapping(guessMapping(parsed.headers));
    return true;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setRowErrors([]);

    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setError('File must be an .xlsx or .xls file');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('File exceeds the 15MB size limit');
      return;
    }

    const buffer = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    if (wb.worksheets.length === 0) {
      setError('No data to import — the file has no sheets');
      return;
    }

    setFileName(file.name);
    setWorkbook(wb);
    setSheetNames(wb.worksheets.map((ws) => ws.name));
    const firstSheetName = wb.worksheets[0].name;
    setSelectedSheet(firstSheetName);
    loadSheet(wb, firstSheetName);
  };

  const handleSheetChange = (sheetName: string) => {
    setSelectedSheet(sheetName);
    setRowErrors([]);
    if (workbook) {
      loadSheet(workbook, sheetName);
    }
  };

  const handleImport = async () => {
    if (!sheet) return;
    setRowErrors([]);

    const colIndex = (field: string) =>
      mapping[field] !== undefined ? Number(mapping[field]) : -1;

    const errors: string[] = [];
    sheet.rows.forEach((row, i) => {
      const requiredValues = REQUIRED_FIELDS.map((f) => row[colIndex(f)] ?? '');
      const filled = requiredValues.filter((v) => v.trim() !== '').length;
      if (filled > 0 && filled < requiredValues.length) {
        errors.push(`Row ${i + 2}: some required fields are blank`);
      }
    });
    if (errors.length > 0) {
      setRowErrors(errors);
      return;
    }

    const plateMap = new Map<
      string,
      {
        plate_id: string;
        accession: string;
        transplant_date: string;
        custom_note: string;
        sections: {
          plate_section_id: string;
          plant_qr: string;
          medium: string;
        }[];
      }
    >();

    for (const row of sheet.rows) {
      const plateId = row[colIndex('Plate ID')];
      if (!plateId) continue;
      if (!plateMap.has(plateId)) {
        plateMap.set(plateId, {
          plate_id: plateId,
          accession: row[colIndex('Accession')] ?? '',
          transplant_date: row[colIndex('Transplant Date')] ?? '',
          custom_note: row[colIndex('Custom Note')] ?? '',
          sections: [],
        });
      }
      plateMap.get(plateId)!.sections.push({
        plate_section_id: row[colIndex('Section ID')] ?? '',
        plant_qr: row[colIndex('Plant QR')] ?? '',
        medium: row[colIndex('Medium')] ?? '',
      });
    }

    const plates = Array.from(plateMap.values());
    const result =
      await window.electron.database.graviPlateAccessions.createWithSections(
        { name: fileName },
        plates
      );

    if (!result.success) {
      setError(result.error ?? 'Failed to import metadata');
      return;
    }

    setDone(true);
    setTimeout(() => {
      reset();
      setDone(false);
      onUploadComplete();
    }, 1500);
  };

  return (
    <div>
      <label htmlFor="metadata-file-input">Spreadsheet File</label>
      <input
        id="metadata-file-input"
        aria-label="Spreadsheet File"
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileChange}
      />
      {error && <p>{error}</p>}

      {sheetNames.length > 1 && (
        <div>
          <label htmlFor="sheet-select">Sheet</label>
          <select
            id="sheet-select"
            aria-label="Sheet"
            value={selectedSheet}
            onChange={(e) => handleSheetChange(e.target.value)}
          >
            {sheetNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}

      {sheet && (
        <div>
          {ALL_FIELDS.map((field) => (
            <div key={field}>
              <label htmlFor={`mapping-${field}`}>{field}</label>
              <select
                id={`mapping-${field}`}
                aria-label={field}
                value={mapping[field] ?? ''}
                onChange={(e) =>
                  setMapping((prev) => ({ ...prev, [field]: e.target.value }))
                }
              >
                <option value="">-- Select column --</option>
                {sheet.headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          ))}

          <table>
            <thead>
              <tr>
                {sheet.headers.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.slice(0, PREVIEW_ROW_LIMIT).map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {rowErrors.length > 0 && (
            <ul>
              {rowErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          <button onClick={handleImport}>Import</button>
        </div>
      )}

      {done && <p>Done uploading!</p>}
    </div>
  );
}
