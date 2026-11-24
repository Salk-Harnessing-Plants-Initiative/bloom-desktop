/**
 * An opened accession file's linked experiments. One with scans links to Browse Scans
 * filtered to it; one not scanned yet links to Experiments with its name searched.
 */

import { Link } from 'react-router-dom';

interface LinkedExperiment {
  id: string;
  name: string;
}

const LINK_CLASS = 'text-lime-700 underline hover:no-underline';

export function AccessionLinkedExperiments({
  experiments,
  scannedExperimentIds,
}: {
  experiments?: LinkedExperiment[];
  scannedExperimentIds?: ReadonlySet<string>;
}) {
  return (
    <div
      className="mt-2 text-sm bg-white border rounded p-2"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="font-semibold mb-1">Linked Experiments:</div>
      {experiments && experiments.length > 0 ? (
        <ul className="list-disc list-inside">
          {experiments.map((exp) => {
            const scanned = scannedExperimentIds?.has(exp.id) ?? false;
            return (
              <li key={exp.id}>
                <Link
                  to={
                    scanned
                      ? `/browse-scans?experiment=${encodeURIComponent(exp.id)}`
                      : `/experiments?search=${encodeURIComponent(exp.name)}`
                  }
                  className={LINK_CLASS}
                >
                  {exp.name}
                </Link>{' '}
                <span className="text-xs text-gray-500">
                  {scanned ? '(view scans)' : '(not scanned yet)'}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="italic text-gray-400">No experiments linked</div>
      )}
    </div>
  );
}
