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
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchFiles = async () => {
    const result =
      await window.electron.database.graviPlateAccessions.listFiles();
    if (result.success) {
      setFiles((result.data as MetadataFile[]) ?? []);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const handleExpand = async (fileId: string) => {
    const next = expandedId === fileId ? null : fileId;
    setExpandedId(next);
    if (next && !plates[fileId]) {
      const result =
        await window.electron.database.graviPlateAccessions.list(fileId);
      if (result.success) {
        setPlates((prev) => ({ ...prev, [fileId]: result.data as Plate[] }));
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}
