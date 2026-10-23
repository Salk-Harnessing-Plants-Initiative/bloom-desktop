/**
 * A CylinderScan experiment's waves and their sowing dates on the Experiments
 * page (#407). A date changes freely until the wave's first scan; after that only
 * with a reason. Every change is recorded with the old and new date, and saved
 * scans keep the age they were saved with.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  MAX_REASON_LENGTH,
  formatSowingDate,
  sowingDateChangeError,
  toIsoDate,
} from '../../utils/sowing-date';
import type { CylinderWaveInfo } from '../../types/cylinder-wave';

function WaveDateEditor({
  wave,
  onSaved,
  onCancel,
}: {
  wave: CylinderWaveInfo;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [sowingDate, setSowingDate] = useState(wave.sowing_date);
  const [reason, setReason] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const hasScans = wave.scanCount > 0;
  const problem =
    sowingDate === wave.sowing_date
      ? null
      : sowingDateChangeError(sowingDate, reason, hasScans, new Date());

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const result =
        await window.electron.database.cylinderWaves.changeSowingDate({
          waveId: wave.id,
          sowingDate,
          reason: reason.trim() || undefined,
        });
      if (result.success) onSaved();
      else setSaveError(result.error ?? 'Could not change the sowing date.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="mt-1 mb-2 bg-amber-50 border-2 border-amber-400 rounded-lg p-3 space-y-2"
      data-testid={`wave-date-editor-${wave.wave_number}`}
    >
      {hasScans && (
        <div className="text-amber-800 space-y-1">
          <p>
            {wave.scanCount} {wave.scanCount === 1 ? 'scan' : 'scans'} in wave{' '}
            {wave.wave_number} {wave.scanCount === 1 ? 'was' : 'were'} saved
            with ages from the old sowing date (
            {formatSowingDate(wave.sowing_date)}). They are not changed: only
            new scans use the new date.
          </p>
          <p>
            If their ages need correcting, that has to be done in Bloom as well.
            Give a reason for the change.
          </p>
        </div>
      )}
      <input
        type="date"
        aria-label="New sowing date"
        value={sowingDate}
        max={toIsoDate(new Date())}
        onChange={(e) => setSowingDate(e.target.value)}
        className="px-3 py-2 border border-gray-300 rounded-md"
      />
      <textarea
        aria-label="Reason"
        placeholder={hasScans ? 'Reason (required)' : 'Reason (optional)'}
        value={reason}
        maxLength={MAX_REASON_LENGTH}
        onChange={(e) => setReason(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-md"
      />
      {problem && <p className="text-red-600">{problem}</p>}
      {saveError && <p className="text-red-600">{saveError}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={
            saving || problem !== null || sowingDate === wave.sowing_date
          }
          className="px-3 py-1.5 rounded-md bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-50"
        >
          Save date
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md border border-gray-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function CylinderWaveDates({ experimentId }: { experimentId: string }) {
  const [waves, setWaves] = useState<CylinderWaveInfo[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result =
        await window.electron.database.cylinderWaves.list(experimentId);
      if (result.success && result.data) {
        setWaves(result.data);
        setLoadError(null);
      } else {
        setLoadError(result.error ?? 'Could not load the waves.');
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unknown error');
    }
  }, [experimentId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (waves.length === 0 && !loadError) return null;

  return (
    <div
      className="ml-2 text-gray-600"
      data-testid={`wave-dates-${experimentId}`}
    >
      <ul>
        {waves.map((wave) => (
          <li key={wave.id}>
            Wave {wave.wave_number}: sown {formatSowingDate(wave.sowing_date)}
            {wave.scanCount > 0 &&
              ` (${wave.scanCount} ${wave.scanCount === 1 ? 'scan' : 'scans'})`}{' '}
            <button
              type="button"
              onClick={() => setEditing(wave.wave_number)}
              className="underline"
            >
              Change date
            </button>
            {editing === wave.wave_number && (
              <WaveDateEditor
                wave={wave}
                onCancel={() => setEditing(null)}
                onSaved={() => {
                  setEditing(null);
                  void load();
                }}
              />
            )}
          </li>
        ))}
      </ul>
      {loadError && <p className="text-sm text-red-600">{loadError}</p>}
    </div>
  );
}
