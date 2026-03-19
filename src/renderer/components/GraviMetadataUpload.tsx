import { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { validateGraviMetadata } from '../utils/graviMetadataValidation';

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
const MAX_PREVIEW_ROWS = 20;

interface GraviMetadataUploadProps {
  onUploadComplete: () => void;
}

interface ColumnMapping {
  plateId: string | null;
  sectionId: string | null;
  plantQr: string | null;
  accession: string | null;
  medium: string | null;
  transplantDate: string | null;
  customNote: string | null;
}

const COLUMN_COLORS: Record<keyof ColumnMapping, string> = {
  plateId: 'bg-green-200',
  sectionId: 'bg-purple-200',
  plantQr: 'bg-blue-200',
  accession: 'bg-amber-200',
  medium: 'bg-teal-200',
  transplantDate: 'bg-rose-200',
  customNote: 'bg-cyan-200',
};

const COLUMN_LABELS: Record<keyof ColumnMapping, string> = {
  plateId: 'Plate ID',
  sectionId: 'Section ID',
  plantQr: 'Plant QR',
  accession: 'Accession',
  medium: 'Medium',
  transplantDate: 'Transplant Date',
  customNote: 'Custom Note',
};

export function GraviMetadataUpload({
  onUploadComplete,
}: GraviMetadataUploadProps) {
  // File state
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Workbook state
  const workbookRef = useRef<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);

  // Column state
  const [columns, setColumns] = useState<string[]>([]);
  const [data, setData] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    plateId: null,
    sectionId: null,
    plantQr: null,
    accession: null,
    medium: null,
    transplantDate: null,
    customNote: null,
  });

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const requiredMapped =
    mapping.plateId &&
    mapping.sectionId &&
    mapping.plantQr &&
    mapping.accession &&
    mapping.medium &&
    mapping.transplantDate;
  const hasFile = fileName !== null;
  const hasMultipleSheets = sheetNames.length > 1;

  const resetForm = useCallback(() => {
    setFileName(null);
    setLoading(false);
    setError(null);
    workbookRef.current = null;
    setSheetNames([]);
    setSelectedSheet(null);
    setColumns([]);
    setData([]);
    setMapping({
      plateId: null,
      sectionId: null,
      plantQr: null,
      accession: null,
      medium: null,
      transplantDate: null,
      customNote: null,
    });
    setIsUploading(false);
    setMessage(null);
    setValidationErrors([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const parseSheet = useCallback(
    (workbook: XLSX.WorkBook, sheetName: string) => {
      const ws = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });

      if (jsonData.length === 0) {
        setColumns([]);
        setData([]);
        return;
      }

      const headers = (jsonData[0] || []).map((h) => String(h ?? ''));
      setColumns(headers);

      const rows = jsonData
        .slice(1, MAX_PREVIEW_ROWS + 1)
        .map((row) => (row || []).map((cell) => String(cell ?? '')));
      setData(rows);

      setMapping({
        plateId: null,
        sectionId: null,
        plantQr: null,
        accession: null,
        medium: null,
        transplantDate: null,
        customNote: null,
      });
      setValidationErrors([]);
    },
    []
  );

  const handleFileChange = useCallback(
    (file: File | null) => {
      setError(null);
      setMessage(null);
      setValidationErrors([]);

      if (!file) return;

      const validExtensions = ['.xlsx', '.xls'];
      const hasValidExtension = validExtensions.some((ext) =>
        file.name.toLowerCase().endsWith(ext)
      );

      if (!hasValidExtension) {
        setError('Only Excel files (.xlsx, .xls) are accepted');
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        setError('File size exceeds 15MB.');
        return;
      }

      setLoading(true);
      setFileName(file.name);

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const workbook = XLSX.read(arrayBuffer, {
            type: 'array',
            cellDates: true,
          });

          workbookRef.current = workbook;
          setSheetNames(workbook.SheetNames);

          const defaultSheet = workbook.SheetNames[0];
          setSelectedSheet(defaultSheet);
          parseSheet(workbook, defaultSheet);
        } catch {
          setError('Failed to parse Excel file.');
        } finally {
          setLoading(false);
        }
      };

      reader.onerror = () => {
        setError('Failed to read file');
        setLoading(false);
      };

      reader.readAsArrayBuffer(file);
    },
    [parseSheet]
  );

  const handleSheetChange = useCallback(
    (sheetName: string) => {
      setSelectedSheet(sheetName);
      if (workbookRef.current) {
        parseSheet(workbookRef.current, sheetName);
      }
    },
    [parseSheet]
  );

  const handleMappingChange = useCallback(
    (field: keyof ColumnMapping, value: string) => {
      setMapping((prev) => ({ ...prev, [field]: value || null }));
      setValidationErrors([]);
    },
    []
  );

  /**
   * Validate and upload
   */
  const handleUpload = useCallback(async () => {
    if (
      !mapping.plateId ||
      !mapping.sectionId ||
      !mapping.plantQr ||
      !mapping.accession ||
      !workbookRef.current ||
      !selectedSheet
    ) {
      return;
    }

    setIsUploading(true);
    setMessage('Validating...');
    setError(null);
    setValidationErrors([]);

    try {
      const ws = workbookRef.current.Sheets[selectedSheet];
      const allData = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });

      if (allData.length <= 1) {
        setError('No data rows found in the file');
        setIsUploading(false);
        return;
      }

      const headers = (allData[0] || []) as string[];
      const plateIdIdx = headers.indexOf(mapping.plateId);
      const sectionIdIdx = headers.indexOf(mapping.sectionId);
      const plantQrIdx = headers.indexOf(mapping.plantQr);
      const accessionIdx = headers.indexOf(mapping.accession);
      const mediumIdx = headers.indexOf(mapping.medium);
      const transplantDateIdx = headers.indexOf(mapping.transplantDate);
      const customNoteIdx = mapping.customNote
        ? headers.indexOf(mapping.customNote)
        : -1;

      if (
        plateIdIdx === -1 ||
        sectionIdIdx === -1 ||
        plantQrIdx === -1 ||
        accessionIdx === -1 ||
        mediumIdx === -1 ||
        transplantDateIdx === -1
      ) {
        setError('Selected columns not found in the file');
        setIsUploading(false);
        return;
      }

      // Parse rows
      type ParsedRow = {
        plateId: string;
        sectionId: string;
        plantQr: string;
        accession: string;
        medium: string;
        transplantDate: string;
        customNote: string | null;
      };

      const rows: ParsedRow[] = [];
      for (let i = 1; i < allData.length; i++) {
        const row = allData[i] || [];
        const plateId = String(row[plateIdIdx] ?? '').trim();
        const sectionId = String(row[sectionIdIdx] ?? '').trim();
        const plantQr = String(row[plantQrIdx] ?? '').trim();
        const accession = String(row[accessionIdx] ?? '').trim();
        const medium = String(row[mediumIdx] ?? '').trim();
        const rawDate = row[transplantDateIdx];
        const transplantDate =
          rawDate instanceof Date
            ? rawDate.toISOString().split('T')[0]
            : typeof rawDate === 'number'
              ? new Date(Math.round((rawDate - 25569) * 86400000))
                  .toISOString()
                  .split('T')[0]
              : String(rawDate ?? '').trim();
        const customNote =
          customNoteIdx >= 0
            ? String(row[customNoteIdx] ?? '').trim() || null
            : null;

        if (
          plateId &&
          sectionId &&
          plantQr &&
          accession &&
          medium &&
          transplantDate
        ) {
          rows.push({
            plateId,
            sectionId,
            plantQr,
            accession,
            medium,
            transplantDate,
            customNote,
          });
        }
      }

      if (rows.length === 0) {
        setError('No valid rows found (all required columns must be filled)');
        setIsUploading(false);
        return;
      }

      // Validation
      const errors = validateGraviMetadata(rows);

      if (errors.length > 0) {
        setValidationErrors(errors);
        setMessage(null);
        setIsUploading(false);
        return;
      }

      // Group by plate
      setMessage('Uploading...');
      const plateMap = new Map<
        string,
        {
          accession: string;
          transplant_date: string | null;
          custom_note: string | null;
          sections: {
            plate_section_id: string;
            plant_qr: string;
            medium?: string | null;
          }[];
        }
      >();

      for (const row of rows) {
        if (!plateMap.has(row.plateId)) {
          plateMap.set(row.plateId, {
            accession: row.accession,
            transplant_date: row.transplantDate,
            custom_note: row.customNote,
            sections: [],
          });
        }
        plateMap.get(row.plateId)!.sections.push({
          plate_section_id: row.sectionId,
          plant_qr: row.plantQr,
          medium: row.medium,
        });
      }

      const plates = Array.from(plateMap.entries()).map(([plate_id, data]) => ({
        plate_id,
        accession: data.accession,
        transplant_date: data.transplant_date,
        custom_note: data.custom_note,
        sections: data.sections,
      }));

      const result =
        await window.electron.database.graviPlateAccessions.createWithSections(
          { name: fileName || 'GraviScan Metadata' },
          plates
        );

      if (result.success) {
        setMessage('Done uploading!');
        setTimeout(() => {
          resetForm();
          onUploadComplete();
        }, 1500);
      } else {
        setError(result.error || 'Upload failed');
      }
    } catch (err) {
      setError('Upload failed. Please try again.');
      console.error('Upload error:', err);
    } finally {
      setIsUploading(false);
    }
  }, [mapping, selectedSheet, fileName, resetForm, onUploadComplete]);

  /**
   * Get column highlight class
   */
  const getColumnClass = (columnName: string): string => {
    for (const [key, color] of Object.entries(COLUMN_COLORS)) {
      if (mapping[key as keyof ColumnMapping] === columnName) {
        return color;
      }
    }
    return '';
  };

  /**
   * Get column label
   */
  const getColumnLabel = (columnName: string): string | null => {
    for (const [key, label] of Object.entries(COLUMN_LABELS)) {
      if (mapping[key as keyof ColumnMapping] === columnName) {
        return label;
      }
    }
    return null;
  };

  // Compute summary when all required columns are mapped
  const summary = (() => {
    if (!requiredMapped || data.length === 0) return null;

    const headers = columns;
    const plateIdIdx = headers.indexOf(mapping.plateId!);
    const accessionIdx = headers.indexOf(mapping.accession!);

    const plates = new Set<string>();
    const accessions = new Set<string>();

    for (const row of data) {
      const p = row[plateIdIdx]?.trim();
      const a = row[accessionIdx]?.trim();
      if (p) plates.add(p);
      if (a) accessions.add(a);
    }

    return {
      uniquePlates: plates.size,
      totalSections: data.filter((row) => row[plateIdIdx]?.trim()).length,
      uniqueAccessions: accessions.size,
    };
  })();

  return (
    <div className="space-y-4">
      {/* Upload Zone */}
      <div className="p-6 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 hover:border-gray-400 transition-colors">
        <div className="text-center">
          <p className="text-sm text-gray-600 font-medium mb-2">
            Upload GraviScan Metadata Excel File
          </p>
          <p className="text-xs text-gray-500 mb-4">
            Drag and drop or click to select XLSX/XLS files (max 15MB)
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
            className="hidden"
          />

          {!hasFile ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Select File
            </button>
          ) : (
            <div className="flex items-center justify-center gap-3">
              <span className="text-sm text-gray-700 font-medium">
                {fileName}
              </span>
              <button
                onClick={resetForm}
                className="text-xs text-red-600 hover:text-red-800"
              >
                Remove
              </button>
            </div>
          )}
        </div>
      </div>

      {loading && <p className="text-sm text-gray-500">Parsing file...</p>}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {validationErrors.length > 0 && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm font-medium text-red-700 mb-1">
            Validation failed:
          </p>
          <ul className="list-disc list-inside text-sm text-red-600 space-y-1">
            {validationErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {message && !error && validationErrors.length === 0 && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-md">
          <p className="text-sm text-green-600">{message}</p>
        </div>
      )}

      {/* Sheet selector */}
      {hasFile && hasMultipleSheets && (
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">
            Sheet
          </label>
          <select
            value={selectedSheet || ''}
            onChange={(e) => handleSheetChange(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm"
          >
            {sheetNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Column Mapping */}
      {hasFile && columns.length > 0 && (
        <div>
          <h3 className="text-xs font-bold mb-2">Map Columns</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {(
              Object.entries(COLUMN_LABELS) as [keyof ColumnMapping, string][]
            ).map(([field, label]) => (
              <div key={field}>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  {label}
                  {field !== 'customNote' && (
                    <span className="text-red-500 ml-0.5">*</span>
                  )}
                </label>
                <select
                  value={mapping[field] || ''}
                  onChange={(e) => handleMappingChange(field, e.target.value)}
                  className={`w-full border rounded-md px-2 py-1.5 text-sm ${
                    mapping[field] ? COLUMN_COLORS[field] : ''
                  }`}
                >
                  <option value="">-- Select --</option>
                  {columns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary */}
      {summary && (
        <div className="flex gap-4 text-xs text-gray-600">
          <span>
            <strong>{summary.uniquePlates}</strong> plate(s)
          </span>
          <span>
            <strong>{summary.totalSections}</strong> section(s)
          </span>
          <span>
            <strong>{summary.uniqueAccessions}</strong> accession(s)
          </span>
          <span className="text-gray-400">(from preview rows)</span>
        </div>
      )}

      {/* Preview Table */}
      {hasFile && data.length > 0 && columns.length > 0 && (
        <div className="border rounded-md overflow-x-auto max-h-80">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-100 border-b">
                {columns.map((col, i) => {
                  const highlight = getColumnClass(col);
                  const label = getColumnLabel(col);
                  return (
                    <th
                      key={i}
                      className={`px-3 py-2 text-left font-medium text-gray-700 ${highlight}`}
                    >
                      {col}
                      {label && (
                        <span className="block text-[10px] font-normal text-gray-500">
                          {label}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                >
                  {columns.map((col, colIdx) => {
                    const highlight = getColumnClass(col);
                    return (
                      <td
                        key={colIdx}
                        className={`px-3 py-1.5 text-gray-600 ${highlight}`}
                      >
                        {row[colIdx] ?? ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload Button */}
      {hasFile && columns.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleUpload}
            disabled={!requiredMapped || isUploading}
            className={`px-4 py-2 text-sm font-medium rounded-md ${
              requiredMapped && !isUploading
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            {isUploading ? 'Uploading...' : 'Upload Metadata'}
          </button>
          {!requiredMapped && (
            <span className="text-xs text-gray-400">
              Map all required columns to upload
            </span>
          )}
        </div>
      )}
    </div>
  );
}
