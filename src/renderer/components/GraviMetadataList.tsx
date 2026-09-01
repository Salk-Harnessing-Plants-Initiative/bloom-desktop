import { useEffect, useState } from 'react';

interface MetadataFile {
  id: string;
  name: string;
  createdAt: string | Date;
  plateCount: number;
  experimentNames: string[];
}

interface Section {
  plate_section_id: string;
  plant_qr: string;
  medium: string;
}

interface Plate {
  plate_id: string;
  accession: string;
  transplant_date?: string | Date | null;
  custom_note?: string | null;
  sections: Section[];
}

// Electron's IPC structured clone preserves Date instances (Prisma's
// DateTime maps to Date), so these fields arrive as either a Date or an
// already-serialized string depending on the caller.
function formatDate(value: string | Date | null | undefined): string {
  if (value == null) return '';
  return typeof value === 'string' ? value : value.toISOString();
}

export function GraviMetadataList() {
  const [files, setFiles] = useState<MetadataFile[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [plates, setPlates] = useState<Record<string, Plate[]>>({});
  const [expandErrors, setExpandErrors] = useState<Record<string, string>>({});
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFiles = async () => {
    setIsLoading(true);
    try {
      const result =
        await window.electron.database.graviPlateAccessions.listFiles();
      if (result.success) {
        setError(null);
        setFiles((result.data as MetadataFile[]) ?? []);
      } else {
        setError(result.error ?? 'Failed to load metadata files');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const handleExpand = async (fileId: string) => {
    const next = expandedId === fileId ? null : fileId;
    setExpandedId(next);
    if (next && !plates[fileId]) {
      // Clear any stale error from a prior failed attempt before retrying —
      // otherwise the old message stays visible for the entire in-flight
      // window of a retry (no loading indicator masks it), misleadingly
      // suggesting the retry click had no effect.
      setExpandErrors((prev) => {
        if (!(fileId in prev)) return prev;
        const withoutStaleError = { ...prev };
        delete withoutStaleError[fileId];
        return withoutStaleError;
      });
      const result =
        await window.electron.database.graviPlateAccessions.list(fileId);
      if (result.success) {
        setPlates((prev) => ({ ...prev, [fileId]: result.data as Plate[] }));
      } else {
        setExpandErrors((prev) => ({
          ...prev,
          [fileId]: result.error ?? 'Failed to load plate data',
        }));
      }
    }
  };

  const handleDelete = async (fileId: string, fileName: string) => {
    if (
      !window.confirm(
        `Delete "${fileName}"? This permanently removes all of its plate and section data and cannot be undone.`
      )
    ) {
      return;
    }
    setDeleteError(null);
    const result =
      await window.electron.database.graviPlateAccessions.delete(fileId);
    if (result.success) {
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    } else {
      setDeleteError(result.error ?? 'Failed to delete metadata file');
    }
  };

  return (
    <div className="bg-white border rounded-lg shadow-sm p-4">
      {deleteError && (
        <p className="text-sm text-red-600 mb-2">{deleteError}</p>
      )}
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading metadata files...</p>
      ) : error ? (
        <p className="text-sm text-red-600 mb-2">{error}</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-gray-500">
          No GraviScan metadata uploaded yet
        </p>
      ) : (
        <ul className="space-y-2">
          {files.map((file) => {
            const expanded = expandedId === file.id;
            return (
              <li
                key={file.id}
                className="bg-gray-50 rounded-lg border border-gray-100"
              >
                <div className="flex items-center gap-2 px-3 py-2">
                  <span
                    onClick={() => handleExpand(file.id)}
                    className={`text-gray-400 cursor-pointer transition-transform ${expanded ? 'rotate-90' : ''}`}
                  >
                    &rsaquo;
                  </span>
                  <span
                    onClick={() => handleExpand(file.id)}
                    className="font-medium cursor-pointer"
                  >
                    {file.name}
                  </span>
                  <span className="text-sm text-gray-600">
                    {formatDate(file.createdAt)}
                  </span>
                  <span className="text-sm text-gray-600">
                    {file.experimentNames.join(', ')}
                  </span>
                  <span className="text-sm text-gray-600">
                    {file.plateCount} plates
                  </span>
                  <button
                    onClick={() => handleDelete(file.id, file.name)}
                    className="ml-auto text-red-600 hover:bg-red-50 rounded px-2 py-1 text-sm"
                  >
                    Delete
                  </button>
                </div>

                {expanded && plates[file.id] && (
                  <table className="w-full text-sm border-t">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th className="px-3 py-2">Plate ID</th>
                        <th className="px-3 py-2">Accession</th>
                        <th className="px-3 py-2">Transplant Date</th>
                        <th className="px-3 py-2">Custom Note</th>
                        <th className="px-3 py-2">Section</th>
                        <th className="px-3 py-2">Plant QR</th>
                        <th className="px-3 py-2">Medium</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {plates[file.id].map((plate) =>
                        plate.sections.map((section, i) => (
                          <tr
                            key={`${plate.plate_id}-${section.plate_section_id}`}
                          >
                            {i === 0 && (
                              <>
                                <td
                                  rowSpan={plate.sections.length}
                                  className="px-3 py-2"
                                >
                                  {plate.plate_id}
                                </td>
                                <td
                                  rowSpan={plate.sections.length}
                                  className="px-3 py-2"
                                >
                                  {plate.accession}
                                </td>
                                <td
                                  rowSpan={plate.sections.length}
                                  className="px-3 py-2"
                                >
                                  {formatDate(plate.transplant_date)}
                                </td>
                                <td
                                  rowSpan={plate.sections.length}
                                  className="px-3 py-2"
                                >
                                  {plate.custom_note}
                                </td>
                              </>
                            )}
                            <td className="px-3 py-2">
                              {section.plate_section_id}
                            </td>
                            <td className="px-3 py-2">{section.plant_qr}</td>
                            <td className="px-3 py-2">{section.medium}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}
                {expanded && !plates[file.id] && expandErrors[file.id] && (
                  <p className="text-sm text-red-600 px-3 py-2">
                    {expandErrors[file.id]}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
