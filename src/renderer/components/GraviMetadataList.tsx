import { useState, useEffect, useCallback } from 'react';

interface MetadataFile {
  id: string;
  name: string;
  createdAt: Date | string;
  experiments: { name: string }[];
  _count: { graviPlateAccessions: number };
}

interface Section {
  id: string;
  plate_section_id: string;
  plant_qr: string;
  medium: string | null;
}

interface Plate {
  id: string;
  plate_id: string;
  accession: string;
  sections: Section[];
}

interface GraviMetadataListProps {
  refreshTrigger: number;
}

export function GraviMetadataList({ refreshTrigger }: GraviMetadataListProps) {
  const [files, setFiles] = useState<MetadataFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFileId, setExpandedFileId] = useState<string | null>(null);
  const [plates, setPlates] = useState<Record<string, Plate[]>>({});
  const [platesLoading, setPlatesLoading] = useState<Record<string, boolean>>(
    {}
  );

  const fetchFiles = useCallback(async () => {
    try {
      setError(null);
      const result =
        await window.electron.database.graviPlateAccessions.listFiles();
      if (result.success) {
        setFiles(result.data as MetadataFile[]);
      } else {
        setError(result.error || 'Failed to load metadata files');
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles, refreshTrigger]);

  const handleExpand = async (fileId: string) => {
    const newExpandedId = expandedFileId === fileId ? null : fileId;
    setExpandedFileId(newExpandedId);

    if (newExpandedId && !plates[newExpandedId]) {
      setPlatesLoading((prev) => ({ ...prev, [newExpandedId]: true }));
      try {
        const result =
          await window.electron.database.graviPlateAccessions.list(
            newExpandedId
          );
        if (result.success) {
          setPlates((prev) => ({
            ...prev,
            [newExpandedId]: result.data as Plate[],
          }));
        }
      } catch {
        // Silently fail; user can retry by collapsing/expanding
      } finally {
        setPlatesLoading((prev) => ({ ...prev, [newExpandedId]: false }));
      }
    }
  };

  const handleDelete = async (fileId: string) => {
    try {
      const result =
        await window.electron.database.graviPlateAccessions.delete(fileId);
      if (result.success) {
        setFiles((prev) => prev.filter((f) => f.id !== fileId));
        if (expandedFileId === fileId) {
          setExpandedFileId(null);
        }
      }
    } catch {
      // Silently fail
    }
  };

  if (isLoading) {
    return (
      <div className="border rounded-md p-4 w-full max-w-2xl flex items-center justify-center min-h-32">
        <p className="text-sm text-gray-500">Loading metadata files...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border rounded-md p-4 w-full max-w-2xl border-red-300 bg-red-50">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="border rounded-md p-4 w-full max-w-2xl flex items-center justify-center min-h-32">
        <p className="text-sm text-gray-500">
          No GraviScan metadata uploaded yet
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl space-y-2">
      {files.map((file) => {
        const isExpanded = expandedFileId === file.id;
        const filePlates = plates[file.id];
        const isLoadingPlates = platesLoading[file.id];

        return (
          <div key={file.id} className="border rounded-md overflow-hidden">
            {/* File header */}
            <div
              className="flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 cursor-pointer"
              onClick={() => handleExpand(file.id)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className={`w-4 h-4 text-gray-400 transition-transform ${
                    isExpanded ? 'rotate-90' : ''
                  }`}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.25 4.5l7.5 7.5-7.5 7.5"
                  />
                </svg>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {file.name}
                  </p>
                  <p className="text-xs text-gray-400">
                    {file._count.graviPlateAccessions} plate(s)
                    {file.experiments.length > 0 && (
                      <span className="ml-2">
                        &middot;{' '}
                        {file.experiments.map((e) => e.name).join(', ')}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(file.id);
                }}
                className="text-xs text-red-500 hover:text-red-700 ml-4 shrink-0"
              >
                Delete
              </button>
            </div>

            {/* Expanded plate details */}
            {isExpanded && (
              <div className="border-t bg-gray-50 px-4 py-3">
                {isLoadingPlates ? (
                  <p className="text-xs text-gray-500">Loading plates...</p>
                ) : filePlates && filePlates.length > 0 ? (
                  <div className="space-y-3">
                    {filePlates.map((plate) => (
                      <div key={plate.id}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-gray-700">
                            {plate.plate_id}
                          </span>
                          <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                            {plate.accession}
                          </span>
                          <span className="text-xs text-gray-400">
                            {plate.sections.length} section(s)
                          </span>
                        </div>
                        <table className="w-full text-xs border rounded">
                          <thead>
                            <tr className="bg-gray-100">
                              <th className="px-2 py-1 text-left text-gray-600">
                                Section
                              </th>
                              <th className="px-2 py-1 text-left text-gray-600">
                                Plant QR
                              </th>
                              <th className="px-2 py-1 text-left text-gray-600">
                                Medium
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {plate.sections.map((section) => (
                              <tr key={section.id} className="border-t">
                                <td className="px-2 py-1 text-gray-700">
                                  {section.plate_section_id}
                                </td>
                                <td className="px-2 py-1 text-gray-700">
                                  {section.plant_qr}
                                </td>
                                <td className="px-2 py-1 text-gray-500">
                                  {section.medium || '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">No plates found</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
