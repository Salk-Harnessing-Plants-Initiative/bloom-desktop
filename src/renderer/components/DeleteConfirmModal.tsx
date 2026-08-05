/**
 * Delete Confirm Modal
 *
 * Shared confirmation modal for soft-deleting a scan, used by both
 * BrowseScans.tsx and ScanPreview.tsx — see the "Delete Scan" requirement
 * in openspec/specs/ui-management-pages/spec.md. Replaces the previous
 * generic window.confirm() with a modal showing the Plant ID and capture
 * date, per add-cylinderscan-delete-upload-integrity.
 */

interface DeleteConfirmModalProps {
  plantId: string;
  captureDate: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmModal({
  plantId,
  captureDate,
  onConfirm,
  onCancel,
}: DeleteConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
      >
        <h2 id="delete-confirm-title" className="text-lg font-bold mb-2">
          Delete this scan?
        </h2>
        <p className="text-sm text-gray-600 mb-1">
          Plant ID: <span className="font-medium">{plantId}</span>
        </p>
        <p className="text-sm text-gray-600 mb-4">
          Captured: <span className="font-medium">{captureDate}</span>
        </p>
        <p className="text-sm text-gray-500 mb-6">
          This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
