/**
 * AccessionFileUpload Component
 *
 * TODO: Full implementation with:
 * - Drag-and-drop file upload
 * - Excel parsing with xlsx library
 * - Sheet selection for multi-sheet files
 * - Column mapping (Plant ID + Genotype ID)
 * - Visual column highlighting (green/blue)
 * - Preview table (first 20 rows)
 * - Batch processing (100 rows at a time)
 * - Progress indicator
 *
 * For now, this is a placeholder component.
 */

export function AccessionFileUpload() {
  return (
    <div className="mt-8 p-6 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50">
      <div className="text-center">
        <p className="text-sm text-gray-600 font-medium">
          Excel File Upload
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Coming soon: Upload XLSX/XLS files to bulk-create plant-accession mappings
        </p>
      </div>
    </div>
  );
}