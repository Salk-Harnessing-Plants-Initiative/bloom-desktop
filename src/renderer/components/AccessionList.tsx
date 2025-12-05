import { useState } from 'react';

interface Accession {
  id: string;
  name: string;
  createdAt: Date | string;
}

interface AccessionListProps {
  accessions: Accession[];
  onUpdate: () => void;
}

export function AccessionList({ accessions, onUpdate }: AccessionListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [mappingCounts, setMappingCounts] = useState<Record<string, number>>(
    {}
  );

  const handleExpand = async (accession: Accession) => {
    const newExpandedId = expandedId === accession.id ? null : accession.id;
    setExpandedId(newExpandedId);

    // Fetch mapping count when expanding
    if (newExpandedId) {
      const result = await window.electron.database.accessions.getMappings(
        accession.id
      );
      if (result.success && result.data) {
        setMappingCounts((prev) => ({
          ...prev,
          [accession.id]: result.data.length,
        }));
      } else {
        console.error('Failed to fetch mappings:', result.error);
        setMappingCounts((prev) => ({
          ...prev,
          [accession.id]: 0,
        }));
      }
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
            <div className="p-3 border-t border-gray-200 bg-gray-50 space-y-2">
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
                  {/* Mapping count */}
                  <div className="text-sm text-gray-600">
                    {mappingCounts[accession.id] !== undefined
                      ? `${mappingCounts[accession.id]} plant mappings`
                      : 'Loading mappings...'}
                  </div>

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
