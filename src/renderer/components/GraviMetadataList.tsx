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
  transplant_date: string | Date | null;
  custom_note: string | null;
  sections: Section[];
}

function formatDate(value: string | Date | null): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().split('T')[0];
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

            {/* Expanded: one flat table with row-merged plate-level cells */}
            {isExpanded && (
              <div className="border-t bg-gray-50 px-4 py-3 overflow-x-auto">
                {isLoadingPlates ? (
                  <p className="text-xs text-gray-500">Loading plates...</p>
                ) : filePlates && filePlates.length > 0 ? (
                  <table className="w-full text-xs border bg-white">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="px-2 py-1.5 text-left text-gray-600 border">
                          Plate ID
                        </th>
                        <th className="px-2 py-1.5 text-left text-gray-600 border">
                          Accession
                        </th>
                        <th className="px-2 py-1.5 text-left text-gray-600 border">
                          Transplant Date
                        </th>
                        <th className="px-2 py-1.5 text-left text-gray-600 border">
                          Custom Note
                        </th>
                        <th className="px-2 py-1.5 text-left text-gray-600 border">
                          Section
                        </th>
                        <th className="px-2 py-1.5 text-left text-gray-600 border">
                          Plant QR
                        </th>
                        <th className="px-2 py-1.5 text-left text-gray-600 border">
                          Medium
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filePlates.flatMap((plate) => {
                        const sections =
                          plate.sections.length > 0
                            ? plate.sections
                            : [
                                {
                                  id: `${plate.id}-empty`,
                                  plate_section_id: '—',
                                  plant_qr: '—',
                                  medium: null,
                                },
                              ];
                        const span = sections.length;
                        return sections.map((section, idx) => (
                          <tr key={section.id} className="border-t">
                            {idx === 0 && (
                              <>
                                <td
                                  rowSpan={span}
                                  className="px-2 py-1 align-top border font-medium text-gray-800 bg-gray-50"
                                >
                                  {plate.plate_id}
                                </td>
                                <td
                                  rowSpan={span}
                                  className="px-2 py-1 align-top border text-amber-700 bg-gray-50"
                                >
                                  {plate.accession}
                                </td>
                                <td
                                  rowSpan={span}
                                  className="px-2 py-1 align-top border text-gray-600 bg-gray-50"
                                >
                                  {formatDate(plate.transplant_date)}
                                </td>
                                <td
                                  rowSpan={span}
                                  className="px-2 py-1 align-top border text-gray-600 bg-gray-50 break-words"
                                >
                                  {plate.custom_note || '—'}
                                </td>
                              </>
                            )}
                            <td className="px-2 py-1 border text-gray-700">
                              {section.plate_section_id}
                            </td>
                            <td className="px-2 py-1 border text-gray-700 break-all">
                              {section.plant_qr}
                            </td>
                            <td className="px-2 py-1 border text-gray-500">
                              {section.medium || '—'}
                            </td>
                          </tr>
                        ));
                      })}
                    </tbody>
                  </table>
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
