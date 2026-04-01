/**
 * Scan File Browser
 *
 * Shows scan output files in real-time during and after scanning.
 * Files being written are marked and non-clickable.
 * Completed files can be clicked to open in system file manager.
 */

import { useState, useEffect, useRef } from 'react';

interface ScanFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
}

interface ScanFileBrowserProps {
  isScanning: boolean;
  /** Set of file paths currently being written (scan-started but not scan-complete) */
  writingFiles: Set<string>;
  /** Set of file paths that need manual QR review */
  needsReviewFiles?: Set<string>;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function ScanFileBrowser({
  isScanning,
  writingFiles,
  needsReviewFiles = new Set(),
}: ScanFileBrowserProps) {
  const [files, setFiles] = useState<ScanFile[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevFileCount = useRef(0);

  // Poll for files — refresh every 2s during scan, 5s otherwise
  useEffect(() => {
    const loadFiles = async () => {
      try {
        const result = await window.electron.graviscan.listScanFiles();
        if (result.success) {
          setFiles(result.files);

          // Auto-scroll to top when new files appear
          if (
            result.files.length > prevFileCount.current &&
            scrollRef.current
          ) {
            scrollRef.current.scrollTop = 0;
          }
          prevFileCount.current = result.files.length;
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };

    loadFiles();
    const interval = setInterval(loadFiles, isScanning ? 2000 : 5000);
    return () => clearInterval(interval);
  }, [isScanning]);

  const handleOpenFolder = async (filePath: string) => {
    await window.electron.graviscan.openFolder(filePath);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Loading files...
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        No scan files yet
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {files.map((file) => {
          // Match by full path or filename (paths may differ after rename)
          const isWriting =
            writingFiles.has(file.path) ||
            [...writingFiles].some(
              (wf) =>
                wf.split('/').pop() === file.name ||
                wf.split('\\').pop() === file.name
            );
          const needsReview =
            needsReviewFiles.has(file.path) ||
            [...needsReviewFiles].some(
              (nf) =>
                nf.split('/').pop() === file.name ||
                nf.split('\\').pop() === file.name
            );

          return (
            <button
              key={file.path}
              onClick={() => !isWriting && handleOpenFolder(file.path)}
              disabled={isWriting}
              className={`w-full text-left px-3 py-2 border-b border-gray-100 flex items-center gap-2 transition-colors ${
                isWriting
                  ? 'bg-amber-50 cursor-not-allowed'
                  : 'hover:bg-blue-50 cursor-pointer'
              }`}
            >
              {/* File icon */}
              <div className="flex-shrink-0">
                {isWriting ? (
                  <svg
                    className="w-4 h-4 text-amber-500 animate-pulse"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-4 h-4 text-green-500"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>

              {/* File info */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">
                  {file.name}
                </p>
                <p className="text-xs text-gray-400">
                  {formatFileSize(file.size)} · {formatTime(file.modifiedAt)}
                  {isWriting && (
                    <span className="ml-2 text-amber-600 font-medium">
                      Writing...
                    </span>
                  )}
                  {!isWriting && needsReview && (
                    <span className="ml-2 text-amber-600 font-medium">
                      Needs Review
                    </span>
                  )}
                </p>
              </div>

              {/* Open folder icon */}
              {!isWriting && (
                <svg
                  className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
