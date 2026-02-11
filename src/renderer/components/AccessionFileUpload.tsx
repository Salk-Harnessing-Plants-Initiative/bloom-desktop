/**
 * AccessionFileUpload Component
 *
 * Provides drag-and-drop Excel file upload for bulk-creating plant-to-genotype
 * mappings. Features include:
 * - Drag-and-drop file upload (XLSX/XLS)
 * - File size validation (max 15MB)
 * - Sheet selection for multi-sheet files
 * - Column mapping (Plant ID + Genotype ID)
 * - Visual column highlighting (green/blue)
 * - Preview table (first 20 rows)
 * - Batch processing with progress indicator
 */

import { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
const MAX_PREVIEW_ROWS = 20;

interface AccessionFileUploadProps {
  onUploadComplete: () => void;
}

export function AccessionFileUpload({
  onUploadComplete,
}: AccessionFileUploadProps) {
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
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);
  const [selectedAccessionCol, setSelectedAccessionCol] = useState<
    string | null
  >(null);

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isUploadDisabled = !selectedPlantId || !selectedAccessionCol;
  const hasFile = fileName !== null;
  const hasMultipleSheets = sheetNames.length > 1;

  /**
   * Reset all state
   */
  const resetForm = useCallback(() => {
    setFileName(null);
    setLoading(false);
    setError(null);
    workbookRef.current = null;
    setSheetNames([]);
    setSelectedSheet(null);
    setColumns([]);
    setData([]);
    setSelectedPlantId(null);
    setSelectedAccessionCol(null);
    setIsUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  /**
   * Parse sheet data
   */
  const parseSheet = useCallback(
    (workbook: XLSX.WorkBook, sheetName: string) => {
      const ws = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });

      if (jsonData.length === 0) {
        setColumns([]);
        setData([]);
        return;
      }

      // First row is headers
      const headers = (jsonData[0] || []).map((h) => String(h ?? ''));
      setColumns(headers);

      // Data rows (limit to MAX_PREVIEW_ROWS for preview)
      const rows = jsonData
        .slice(1, MAX_PREVIEW_ROWS + 1)
        .map((row) => (row || []).map((cell) => String(cell ?? '')));
      setData(rows);

      // Reset column selections when sheet changes
      setSelectedPlantId(null);
      setSelectedAccessionCol(null);
    },
    []
  );

  /**
   * Handle file selection
   */
  const handleFileChange = useCallback(
    (file: File | null) => {
      setError(null);
      setMessage(null);

      if (!file) return;

      // Validate file type
      const validTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
      ];
      const validExtensions = ['.xlsx', '.xls'];
      const hasValidExtension = validExtensions.some((ext) =>
        file.name.toLowerCase().endsWith(ext)
      );

      if (!validTypes.includes(file.type) && !hasValidExtension) {
        setError('Only Excel files (.xlsx, .xls) are accepted');
        return;
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        setError(
          'File size exceeds 15MB. Please split into smaller files and upload separately.'
        );
        return;
      }

      setLoading(true);
      setFileName(file.name);

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const workbook = XLSX.read(arrayBuffer, { type: 'array' });

          workbookRef.current = workbook;
          setSheetNames(workbook.SheetNames);

          // Select first sheet by default
          const defaultSheet = workbook.SheetNames[0];
          setSelectedSheet(defaultSheet);
          parseSheet(workbook, defaultSheet);
        } catch (err) {
          setError('Failed to parse Excel file. Please check the file format.');
          console.error('Excel parsing error:', err);
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

  /**
   * Handle sheet selection change
   */
  const handleSheetChange = useCallback(
    (sheetName: string) => {
      setSelectedSheet(sheetName);
      if (workbookRef.current) {
        parseSheet(workbookRef.current, sheetName);
      }
    },
    [parseSheet]
  );

  /**
   * Handle upload
   */
  const handleUpload = useCallback(async () => {
    if (
      !selectedPlantId ||
      !selectedAccessionCol ||
      !workbookRef.current ||
      !selectedSheet
    ) {
      return;
    }

    setIsUploading(true);
    setMessage('Uploading...');
    setError(null);

    try {
      // Get all rows from the selected sheet
      const ws = workbookRef.current.Sheets[selectedSheet];
      const allData = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });

      if (allData.length <= 1) {
        setError('No data rows found in the file');
        setIsUploading(false);
        return;
      }

      const headers = allData[0] || [];
      const plantIdIndex = headers.indexOf(selectedPlantId);
      const accessionNameIndex = headers.indexOf(selectedAccessionCol);

      if (plantIdIndex === -1 || accessionNameIndex === -1) {
        setError('Selected columns not found');
        setIsUploading(false);
        return;
      }

      // Build mappings array (skip header row)
      const mappings: { plant_barcode: string; accession_name: string }[] = [];
      for (let i = 1; i < allData.length; i++) {
        const row = allData[i] || [];
        const plantBarcode = String(row[plantIdIndex] ?? '').trim();
        const accessionName = String(row[accessionNameIndex] ?? '').trim();

        // Skip rows with empty plant barcode or accession name
        if (plantBarcode && accessionName) {
          mappings.push({
            plant_barcode: plantBarcode,
            accession_name: accessionName,
          });
        }
      }

      if (mappings.length === 0) {
        setError('No valid mappings found in the file');
        setIsUploading(false);
        return;
      }

      // Call IPC to create accession with mappings
      const result =
        await window.electron.database.accessions.createWithMappings(
          { name: fileName || 'Uploaded Accession' },
          mappings
        );

      if (result.success) {
        setMessage('Done uploading!');
        // Reset form after brief delay to show success message
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
  }, [
    selectedPlantId,
    selectedAccessionCol,
    selectedSheet,
    fileName,
    resetForm,
    onUploadComplete,
  ]);

  /**
   * Get column highlight class
   */
  const getColumnClass = (columnName: string): string => {
    if (columnName === selectedPlantId) {
      return 'bg-green-200';
    }
    if (columnName === selectedAccessionCol) {
      return 'bg-blue-200';
    }
    return '';
  };

  /**
   * Get column label
   */
  const getColumnLabel = (columnName: string): string | null => {
    if (columnName === selectedPlantId) {
      return '🌱 Plant ID';
    }
    if (columnName === selectedAccessionCol) {
      return '🏷️ Accession';
    }
    return null;
  };

  return (
    <div className="mt-8 space-y-4">
      {/* Upload Zone */}
      <div
        data-testid="excel-upload-zone"
        className="p-6 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 hover:border-gray-400 transition-colors"
      >
        <div className="text-center">
          <p className="text-sm text-gray-600 font-medium mb-2">
            Upload Excel File
          </p>
          <p className="text-xs text-gray-500 mb-4">
            Drag and drop or click to select XLSX/XLS files (max 15MB)
          </p>

          <input
            ref={fileInputRef}
            type="file"
            data-testid="file-input"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
          />
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-4">
          <svg
            className="animate-spin h-5 w-5 text-gray-600 mr-2"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="text-sm text-gray-600">Loading file...</span>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Success/Status Message */}
      {message && !error && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-md">
          <p className="text-sm text-green-600">{message}</p>
        </div>
      )}

      {/* File Info and Controls */}
      {hasFile && !loading && columns.length > 0 && (
        <div className="space-y-4 p-4 border border-gray-200 rounded-lg bg-white">
          {/* File Name */}
          <div className="text-sm font-medium text-gray-700">{fileName}</div>

          {/* Sheet Selector (only for multi-sheet files) */}
          {hasMultipleSheets && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-700">
                Select Sheet:
              </label>
              <select
                data-testid="sheet-selector"
                value={selectedSheet || ''}
                onChange={(e) => handleSheetChange(e.target.value)}
                className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {sheetNames.map((sheet) => (
                  <option key={sheet} value={sheet}>
                    {sheet}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Column Mapping */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-700">
                Select Plant ID (Barcode) Column:
              </label>
              <select
                data-testid="plant-id-selector"
                value={selectedPlantId || ''}
                onChange={(e) => setSelectedPlantId(e.target.value || null)}
                className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">Select...</option>
                {columns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-700">
                Select Accession Column:
              </label>
              <select
                data-testid="accession-selector"
                value={selectedAccessionCol || ''}
                onChange={(e) =>
                  setSelectedAccessionCol(e.target.value || null)
                }
                className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select...</option>
                {columns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Preview Table */}
          <div
            data-testid="preview-table"
            className="overflow-x-auto max-h-64 border border-gray-200 rounded-md"
          >
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  {columns.map((col) => {
                    const label = getColumnLabel(col);
                    return (
                      <th
                        key={col}
                        className={`px-3 py-2 text-left font-medium text-gray-700 border-b ${getColumnClass(col)}`}
                      >
                        {col}
                        {label && (
                          <span className="ml-2 text-xs font-normal">
                            {label}
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.map((row, rowIndex) => (
                  <tr key={rowIndex} className="even:bg-gray-50">
                    {columns.map((col, colIndex) => (
                      <td
                        key={colIndex}
                        className={`px-3 py-2 border-b border-gray-100 ${getColumnClass(col)}`}
                      >
                        {row[colIndex] || ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.length === MAX_PREVIEW_ROWS && (
            <p className="text-xs text-gray-500 italic">
              Showing first {MAX_PREVIEW_ROWS} rows. All rows will be uploaded.
            </p>
          )}

          {/* Upload Button */}
          <div className="flex items-center gap-4">
            <button
              data-testid="upload-button"
              onClick={handleUpload}
              disabled={isUploadDisabled || isUploading}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                isUploadDisabled || isUploading
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-500 text-white hover:bg-blue-600'
              }`}
            >
              {isUploading ? 'Uploading...' : 'Upload Accession File'}
            </button>

            <button
              onClick={resetForm}
              className="px-4 py-2 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
