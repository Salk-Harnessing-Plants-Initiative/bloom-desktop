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
    <div>
      {deleteError && <p>{deleteError}</p>}
      <ul>
        {files.map((file) => (
          <li key={file.id}>
            <span
              onClick={() => handleExpand(file.id)}
              style={{ cursor: 'pointer' }}
            >
              {file.name}
            </span>
            <span> {formatDate(file.createdAt)}</span>
            <span> {file.experimentNames.join(', ')}</span>
            <span> {file.plateCount} plates</span>
            <button onClick={() => handleDelete(file.id, file.name)}>
              Delete
            </button>

            {expandedId === file.id && plates[file.id] && (
              <table>
                <tbody>
                  {plates[file.id].map((plate) =>
                    plate.sections.map((section, i) => (
                      <tr key={`${plate.plate_id}-${section.plate_section_id}`}>
                        {i === 0 && (
                          <>
                            <td rowSpan={plate.sections.length}>
                              {plate.plate_id}
                            </td>
                            <td rowSpan={plate.sections.length}>
                              {plate.accession}
                            </td>
                            <td rowSpan={plate.sections.length}>
                              {formatDate(plate.transplant_date)}
                            </td>
                            <td rowSpan={plate.sections.length}>
                              {plate.custom_note}
                            </td>
                          </>
                        )}
                        <td>{section.plate_section_id}</td>
                        <td>{section.plant_qr}</td>
                        <td>{section.medium}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
