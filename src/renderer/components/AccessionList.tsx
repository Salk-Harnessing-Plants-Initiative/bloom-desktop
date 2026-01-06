import { useState } from 'react';

interface Experiment {
  id: string;
  name: string;
}

interface Accession {
  id: string;
  name: string;
  createdAt: Date | string;
  experiments?: Experiment[];
}

interface PlantMapping {
  id: string;
  plant_barcode: string;
  genotype_id: string;
}

interface AccessionListProps {
  accessions: Accession[];
  onUpdate: () => void;
}

export function AccessionList({ accessions, onUpdate }: AccessionListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [mappings, setMappings] = useState<Record<string, PlantMapping[]>>({});
  const [mappingsLoading, setMappingsLoading] = useState<
    Record<string, boolean>
  >({});

  // Inline mapping edit state
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);
  const [editingGenotypeId, setEditingGenotypeId] = useState('');

  const handleExpand = async (accession: Accession) => {
    const newExpandedId = expandedId === accession.id ? null : accession.id;
    setExpandedId(newExpandedId);

    // Fetch mappings when expanding
    if (newExpandedId && !mappings[accession.id]) {
      setMappingsLoading((prev) => ({ ...prev, [accession.id]: true }));

      const result = await window.electron.database.accessions.getMappings(
        accession.id
      );

      if (result.success && result.data) {
        setMappings((prev) => ({
          ...prev,
          [accession.id]: result.data,
        }));
      } else {
        console.error('Failed to fetch mappings:', result.error);
        setMappings((prev) => ({
          ...prev,
          [accession.id]: [],
        }));
      }

      setMappingsLoading((prev) => ({ ...prev, [accession.id]: false }));
    }
  };

  const handleEditStart = (accession: Accession) => {
    setEditingId(accession.id);
    setEditName(accession.name);
  };

  const handleEditSave = async (id: string) => {
    if (!editName.trim()) return;

    const result = await window.electron.database.accessions.update(id, {
      name: editName.trim(),
    });

    if (result.success) {
      setEditingId(null);
      onUpdate(); // Refresh list
    } else {
      // eslint-disable-next-line no-alert
      alert(`Failed to update accession: ${result.error || 'Unknown error'}`);
    }
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleDelete = async (id: string, name: string) => {
    // eslint-disable-next-line no-restricted-globals
    const confirmed = confirm(`Delete accession "${name}"?`);
    if (!confirmed) return;

    const result = await window.electron.database.accessions.delete(id);
    if (result.success) {
      onUpdate(); // Refresh list
    } else {
      // eslint-disable-next-line no-alert
      alert(`Failed to delete accession: ${result.error || 'Unknown error'}`);
    }
  };

  // Inline mapping editing handlers
  const handleMappingEditStart = (mapping: PlantMapping) => {
    setEditingMappingId(mapping.id);
    setEditingGenotypeId(mapping.genotype_id || '');
  };

  const handleMappingEditSave = async (
    accessionId: string,
    mappingId: string
  ) => {
    if (!editingGenotypeId.trim()) {
      setEditingMappingId(null);
      return;
    }

    const result = await window.electron.database.accessions.updateMapping(
      mappingId,
      { genotype_id: editingGenotypeId.trim() }
    );

    if (result.success) {
      // Update local state
      setMappings((prev) => ({
        ...prev,
        [accessionId]: prev[accessionId].map((m) =>
          m.id === mappingId
            ? { ...m, genotype_id: editingGenotypeId.trim() }
            : m
        ),
      }));
      setEditingMappingId(null);
    } else {
      // eslint-disable-next-line no-alert
      alert(`Failed to update mapping: ${result.error || 'Unknown error'}`);
    }
  };

  const handleMappingEditCancel = () => {
    setEditingMappingId(null);
    setEditingGenotypeId('');
  };

  if (accessions.length === 0) {
    return (
      <div className="text-sm text-gray-500 italic">No accessions yet</div>
    );
  }

  return (
    <div className="space-y-2">
      {accessions.map((accession) => (
        <div
          key={accession.id}
          data-testid="accession-item"
          className="border border-gray-300 rounded-md"
        >
          {/* Collapsed view */}
          <button
            onClick={() => handleExpand(accession)}
            className="w-full text-left p-3 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <div className="flex justify-between items-center">
              <div>
                <div className="font-medium text-sm">{accession.name}</div>
                <div className="text-xs text-gray-500">
                  Created: {new Date(accession.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="text-gray-400">
                {expandedId === accession.id ? '▼' : '▶'}
              </div>
            </div>
          </button>

          {/* Expanded view */}
          {expandedId === accession.id && (
            <div className="p-3 border-t border-gray-200 bg-gray-50 space-y-3">
              {/* Edit mode */}
              {editingId === accession.id ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleEditSave(accession.id);
                      } else if (e.key === 'Escape') {
                        handleEditCancel();
                      }
                    }}
                    className="w-full p-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEditSave(accession.id)}
                      className="px-3 py-1 bg-blue-500 text-white text-xs rounded-md hover:bg-blue-600"
                    >
                      Save
                    </button>
                    <button
                      onClick={handleEditCancel}
                      className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded-md hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Linked Experiments */}
                  <div
                    className="mt-2 text-sm bg-white border rounded p-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="font-semibold mb-1">
                      Linked Experiments:
                    </div>

                    {accession.experiments &&
                    accession.experiments.length > 0 ? (
                      <ul className="list-disc list-inside">
                        {accession.experiments.map((exp) => (
                          <li key={exp.id}>{exp.name}</li>
                        ))}
                      </ul>
                    ) : (
                      <div className="italic text-gray-400">
                        No experiments linked
                      </div>
                    )}
                  </div>

                  {/* Mapping count */}
                  <div className="text-sm text-gray-600">
                    {mappingsLoading[accession.id]
                      ? 'Loading mappings...'
                      : mappings[accession.id]
                        ? `${mappings[accession.id].length} plant mappings`
                        : '0 plant mappings'}
                  </div>

                  {/* Mappings table */}
                  {mappings[accession.id] &&
                    mappings[accession.id].length > 0 && (
                      <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-md bg-white">
                        <table
                          data-testid="mappings-table"
                          className="w-full text-xs"
                        >
                          <thead className="bg-gray-100 sticky top-0">
                            <tr>
                              <th className="px-2 py-1 text-left font-medium text-gray-700">
                                Plant Barcode
                              </th>
                              <th className="px-2 py-1 text-left font-medium text-gray-700">
                                Genotype ID
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {mappings[accession.id].map((mapping) => (
                              <tr
                                key={mapping.id}
                                className="border-t border-gray-100 hover:bg-gray-50"
                              >
                                <td className="px-2 py-1">
                                  {mapping.plant_barcode}
                                </td>
                                <td
                                  className="px-2 py-1 cursor-pointer"
                                  onClick={() =>
                                    handleMappingEditStart(mapping)
                                  }
                                >
                                  {editingMappingId === mapping.id ? (
                                    <input
                                      type="text"
                                      value={editingGenotypeId}
                                      onChange={(e) =>
                                        setEditingGenotypeId(e.target.value)
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          handleMappingEditSave(
                                            accession.id,
                                            mapping.id
                                          );
                                        } else if (e.key === 'Escape') {
                                          handleMappingEditCancel();
                                        }
                                      }}
                                      onBlur={() =>
                                        handleMappingEditSave(
                                          accession.id,
                                          mapping.id
                                        )
                                      }
                                      className="w-full px-1 py-0.5 border border-blue-400 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                      autoFocus
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  ) : (
                                    <span className="hover:text-blue-600">
                                      {mapping.genotype_id || '—'}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEditStart(accession)}
                      className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(accession.id, accession.name)}
                      className="px-3 py-1 bg-red-100 text-red-700 text-xs rounded-md hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
