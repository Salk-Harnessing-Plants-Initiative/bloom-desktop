/**
 * ScanNotSavedWarning Component
 *
 * Shown on Capture Scan when the images were captured but the Scan/Image
 * rows could not be written to the database (#392). Stays visible until
 * dismissed or the next scan starts, so the operator can note the folder.
 */

export interface UnsavedScan {
  /** Folder the images were written to */
  outputPath: string;
  /** Database error message */
  error?: string;
}

/**
 * Last non-empty line of the database error, or null if it has none.
 * Prisma messages start with an "Invalid `prisma.scan.create()` invocation"
 * header, then a file path and code frame, and end with the cause (e.g.
 * "Foreign key constraint failed…"). The banner shows that cause, truncated
 * with an ellipsis, and the full text on hover.
 */
function errorCause(message: string): string | null {
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.length > 0 ? lines[lines.length - 1] : null;
}

export interface ScanNotSavedWarningProps {
  scan: UnsavedScan;
  onDismiss: () => void;
}

export function ScanNotSavedWarning({
  scan,
  onDismiss,
}: ScanNotSavedWarningProps) {
  return (
    <div
      className="bg-red-50 border-2 border-red-500 rounded-lg p-4"
      role="alert"
      data-testid="scan-not-saved-warning"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start min-w-0">
          <svg
            className="h-5 w-5 text-red-600 mr-2 mt-0.5 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <div className="text-red-800 min-w-0">
            <p className="font-medium">
              Scan images were captured but NOT saved to the database.
            </p>
            <p className="text-sm mt-1">
              This scan will not appear in Browse Scans or Export and will not
              be uploaded. Note the folder below and report the problem before
              rescanning this plant.
            </p>
            <p className="text-sm mt-1">
              Images on disk:{' '}
              <span
                className="font-mono break-all"
                data-testid="scan-not-saved-path"
              >
                {scan.outputPath}
              </span>
            </p>
            {scan.error && errorCause(scan.error) && (
              <p
                className="text-sm mt-1 truncate"
                title={scan.error}
                data-testid="scan-not-saved-error"
              >
                Database error: {errorCause(scan.error)}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="ml-4 text-red-600 hover:text-red-800"
          aria-label="Dismiss scan not saved warning"
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
