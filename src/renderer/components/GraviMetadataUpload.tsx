import { useEffect, useMemo, useState } from 'react';
import { useUnsavedChanges } from '../contexts/UnsavedChangesContext';
import {
  validateGraviMetadata,
  GraviMetadataRow,
} from '../utils/graviMetadataValidation';

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

// One distinct color per mapped field role, so the live preview table
// visually reinforces which column maps to which field (spec.md's "Column
// mapping" scenario) — an unmapped column gets no class at all.
const COLUMN_COLORS: Record<string, string> = {
  'Plate ID': 'bg-blue-50',
  'Section ID': 'bg-green-50',
  'Plant QR': 'bg-purple-50',
  Accession: 'bg-yellow-50',
  Medium: 'bg-pink-50',
  'Transplant Date': 'bg-orange-50',
  'Custom Note': 'bg-gray-100',
};

function getColumnClass(
  headerIndex: number,
  mapping: Record<string, string>
): string {
  const field = ALL_FIELDS.find((f) => mapping[f] === String(headerIndex));
  return field ? COLUMN_COLORS[field] : '';
}

function describeCollision(
  fields: string[],
  position: number,
  headerText: string
): string {
  const columnDescriptor = headerText
    ? `column ${position}, header '${headerText}'`
    : `column ${position}`;
  const fieldList =
    fields.length === 2
      ? `${fields[0]} and ${fields[1]} are both`
      : `${fields.slice(0, -1).join(', ')}, and ${fields[fields.length - 1]} are all`;
  return `${fieldList} mapped to the same ${columnDescriptor} — choose a different column for each.`;
}

// Finds fields whose mapping points at the same spreadsheet column — the
// mapping dropdowns are otherwise fully independent, so nothing else stops
// e.g. Medium and Custom Note both being assigned column 4. Excludes
// unmapped fields: an untouched field's mapping value is `undefined` (only
// a field guessMapping matched, or one the user explicitly set, has a key
// at all), and an explicitly-cleared field's value is `''` — both must be
// excluded, or every unmapped field would appear to collide with every
// other one on a phantom shared "column". Named by position (not solely by
// header text), since a real spreadsheet's header row can be blank or have
// duplicate text across columns.
function findMappingCollisions(
  mapping: Record<string, string>,
  headers: string[]
): string[] {
  const fieldsByColumn = new Map<number, string[]>();
  for (const field of ALL_FIELDS) {
    const raw = mapping[field] ?? '';
    if (raw === '') continue;
    const columnIndex = Number(raw);
    const fields = fieldsByColumn.get(columnIndex) ?? [];
    fields.push(field);
    fieldsByColumn.set(columnIndex, fields);
  }
  const errors: string[] = [];
  for (const [columnIndex, fields] of fieldsByColumn) {
    if (fields.length > 1) {
      errors.push(
        describeCollision(fields, columnIndex + 1, headers[columnIndex] ?? '')
      );
    }
  }
  return errors;
}

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
  const [isParsing, setIsParsing] = useState(false);
  const { setHasUnsavedChanges, setBlockNavigation } = useUnsavedChanges();

  // Rows with every required field blank (e.g. a trailing blank Excel row)
  // don't trigger the partial-row validation error below and are silently
  // excluded by handleImport's plate-grouping loop — surface a count here
  // so the operator knows rows were dropped instead of just importing fewer
  // plates than the sheet appears to contain.
  const blankRowCount = useMemo(() => {
    if (!sheet) return 0;
    const colIndex = (field: string) =>
      mapping[field] ? Number(mapping[field]) : -1;
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

    setIsParsing(true);
    const buffer = await file.arrayBuffer();
    const result = await window.electron.gravi.parseExcelFile(buffer);
    setIsParsing(false);
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
    setError(null);

    try {
      const collisionErrors = findMappingCollisions(mapping, sheet.headers);
      if (collisionErrors.length > 0) {
        setRowErrors(collisionErrors);
        return;
      }

      const colIndex = (field: string) =>
        mapping[field] ? Number(mapping[field]) : -1;

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

      // Format/uniqueness checks (plate ID pattern consistency, consistent
      // accession per plate, duplicate section/QR — closes #207/#313) run
      // client-side, against the rows as entered, before Import — so the
      // operator sees a specific error instead of a generic backend
      // rejection, or worse, a silent wrong-order plate auto-assignment
      // downstream on Capture Scan. Built from `sheet.rows` directly, not
      // from the plate-grouped structure below, which only keeps one
      // (first-seen) accession per plate_id and would hide exactly the
      // inconsistency this is meant to catch.
      const validationRows: GraviMetadataRow[] = sheet.rows
        .filter((row) => (row[colIndex('Plate ID')] ?? '').trim() !== '')
        .map((row) => ({
          plateId: row[colIndex('Plate ID')] ?? '',
          sectionId: row[colIndex('Section ID')] ?? '',
          plantQr: row[colIndex('Plant QR')] ?? '',
          accession: row[colIndex('Accession')] ?? '',
          medium: row[colIndex('Medium')] || null,
        }));
      const metadataErrors = validateGraviMetadata(validationRows);
      if (metadataErrors.length > 0) {
        setRowErrors(metadataErrors);
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
    <div className="bg-white border rounded-lg shadow-sm p-4">
      <div className="flex items-center gap-3 mb-2">
        <label
          htmlFor="metadata-file-input"
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm cursor-pointer"
        >
          Spreadsheet File
        </label>
        <input
          id="metadata-file-input"
          aria-label="Spreadsheet File"
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
          className="hidden"
        />
        {fileName && (
          <>
            <span className="text-sm text-gray-600">{fileName}</span>
            <button
              onClick={reset}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Remove
            </button>
          </>
        )}
      </div>
      {isParsing && <p className="text-sm text-gray-500">Parsing file...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {sheetNames.length > 1 && (
        <div className="mb-3">
          <label
            htmlFor="sheet-select"
            className="block text-xs font-bold mb-1"
          >
            Sheet
          </label>
          <select
            id="sheet-select"
            aria-label="Sheet"
            value={selectedSheet}
            onChange={(e) => handleSheetChange(e.target.value)}
            className="p-2 rounded-md bg-white text-sm border border-gray-300 focus:outline-none"
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
            <p className="text-sm text-amber-600 mb-2">
              {blankRowCount} row{blankRowCount === 1 ? '' : 's'} with no data
              in any required field will be skipped
            </p>
          )}
          <div className="flex flex-wrap gap-3 mb-3">
            {ALL_FIELDS.map((field) => (
              <div key={field}>
                <label
                  htmlFor={`mapping-${field}`}
                  className="block text-xs font-bold mb-1"
                >
                  {field}
                </label>
                <select
                  id={`mapping-${field}`}
                  aria-label={field}
                  value={mapping[field] ?? ''}
                  onChange={(e) =>
                    setMapping((prev) => ({
                      ...prev,
                      [field]: e.target.value,
                    }))
                  }
                  className="p-2 rounded-md bg-white text-sm border border-gray-300 focus:outline-none"
                >
                  <option value="">-- Select column --</option>
                  {sheet.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {i + 1}. {h || '(blank header)'}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <table className="w-full text-sm border-collapse mb-3">
            <thead>
              <tr>
                {sheet.headers.map((h, i) => (
                  <th
                    key={i}
                    data-testid={`preview-header-${i}`}
                    className={getColumnClass(i, mapping)}
                  >
                    {i + 1}. {h || '(blank header)'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.slice(0, PREVIEW_ROW_LIMIT).map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      data-testid={`preview-cell-${i}-${j}`}
                      className={getColumnClass(j, mapping)}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {rowErrors.length > 0 && (
            <ul className="text-sm text-red-600 mb-3 list-disc pl-5">
              {rowErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          <button
            onClick={handleImport}
            disabled={isImporting}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {isImporting ? 'Importing...' : 'Import'}
          </button>
        </div>
      )}

      {done && <p className="text-sm text-green-700 mt-2">Done uploading!</p>}
    </div>
  );
}
