import { useEffect, useMemo, useState } from 'react';
import { useUnsavedChanges } from '../contexts/UnsavedChangesContext';

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

export function GraviMetadataUpload({
  onUploadComplete,
}: GraviMetadataUploadProps) {
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<string[]>([]);
  const [sheetsByName, setSheetsByName] = useState<Record<
    string,
    ParsedSheet
  > | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState<string>('');
  const [done, setDone] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const { setHasUnsavedChanges, setBlockNavigation } = useUnsavedChanges();

  // Rows with every required field blank (e.g. a trailing blank Excel row)
  // don't trigger the partial-row validation error below and are silently
  // excluded by handleImport's plate-grouping loop — surface a count here
  // so the operator knows rows were dropped instead of just importing fewer
  // plates than the sheet appears to contain.
  const blankRowCount = useMemo(() => {
    if (!sheet) return 0;
    const colIndex = (field: string) =>
      mapping[field] !== undefined ? Number(mapping[field]) : -1;
    return sheet.rows.filter((row) =>
      REQUIRED_FIELDS.every((f) => (row[colIndex(f)] ?? '').trim() === '')
    ).length;
  }, [sheet, mapping]);

  // A parsed sheet with its column mapping is real, easy-to-lose work
  // (the operator may have had to manually fix auto-mapping) — flag it so
  // Layout.tsx's sidebar nav confirms before a click away silently
  // discards it. Cleared once done/reset, and unconditionally on unmount
  // so navigating past a confirmed "leave anyway" doesn't leave the flag
  // stuck for whatever page comes next.
  useEffect(() => {
    setHasUnsavedChanges(sheet !== null && !done);
  }, [sheet, done, setHasUnsavedChanges]);

  // blockNavigation itself is set directly in handleImport (see there) —
  // while the createWithSections IPC call is actually in flight, a
  // confirm-and-leave would let its response (setError/setDone, both
  // scheduled after the awaited call) resolve against an unmounted
  // component, and an operator who assumes the failed-silently import
  // never happened could resubmit and create a duplicate record — so this
  // is a hard block, not a dismissable confirm.
  useEffect(() => {
    return () => {
      setHasUnsavedChanges(false);
      setBlockNavigation(false);
    };
  }, [setHasUnsavedChanges, setBlockNavigation]);

  const reset = () => {
    setSheetsByName(null);
    setSheetNames([]);
    setSelectedSheet('');
    setSheet(null);
    setMapping({});
    setFileName('');
    setError(null);
    setRowErrors([]);
  };

  const loadSheet = (
    sheets: Record<string, ParsedSheet>,
    sheetName: string
  ): boolean => {
    const parsed = sheets[sheetName];
    if (!parsed) return false;
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
    const result = await window.electron.gravi.parseExcelFile(buffer);
    if (!result.success || !result.data) {
      setError(result.error || 'Failed to parse spreadsheet');
      return;
    }
    const { sheetNames: parsedSheetNames, sheets } = result.data;
    if (parsedSheetNames.length === 0) {
      setError('No data to import — the file has no sheets');
      return;
    }

    setFileName(file.name);
    setSheetsByName(sheets);
    setSheetNames(parsedSheetNames);
    const firstSheetName = parsedSheetNames[0];
    setSelectedSheet(firstSheetName);
    loadSheet(sheets, firstSheetName);
  };

  const handleSheetChange = (sheetName: string) => {
    setSelectedSheet(sheetName);
    setRowErrors([]);
    if (sheetsByName) {
      loadSheet(sheetsByName, sheetName);
    }
  };

  const handleImport = async () => {
    if (!sheet || isImporting) return;
    setIsImporting(true);
    // Set directly here, not via a useEffect keyed on `isImporting` — that
    // derived effect runs one render behind the state update it watches, a
    // window (sub-frame, not humanly triggerable, but a real design smell)
    // in which a nav click could see blockNavigation still false and get
    // the dismissable confirm instead of the hard block this exists for.
    setBlockNavigation(true);
    setRowErrors([]);

    try {
      const colIndex = (field: string) =>
        mapping[field] !== undefined ? Number(mapping[field]) : -1;

      const errors: string[] = [];
      sheet.rows.forEach((row, i) => {
        const requiredValues = REQUIRED_FIELDS.map(
          (f) => row[colIndex(f)] ?? ''
        );
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
        // .trim() matches blankRowCount's own blank-detection above — a
        // whitespace-only Plate ID is truthy and would otherwise slip past
        // the plain `!plateId` check as a real, blank/whitespace plate.
        if (!plateId?.trim()) continue;
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
    } finally {
      setIsImporting(false);
      setBlockNavigation(false);
    }
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
          {blankRowCount > 0 && (
            <p>
              {blankRowCount} row{blankRowCount === 1 ? '' : 's'} with no data
              in any required field will be skipped
            </p>
          )}
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

          <button onClick={handleImport} disabled={isImporting}>
            {isImporting ? 'Importing...' : 'Import'}
          </button>
        </div>
      )}

      {done && <p>Done uploading!</p>}
    </div>
  );
}
