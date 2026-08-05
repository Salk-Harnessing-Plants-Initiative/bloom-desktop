import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPlateAssignments,
  type GridMode,
  type PlateAssignment,
} from '../../types/graviscan';

export interface UsePlateAssignmentsParams {
  experimentId: string | null;
  waveNumber: number;
  /** Scanners currently assigned to this session, in assignment order —
   * available plates for a linked wave are distributed across them in
   * that order, continuing the index from one scanner to the next. */
  scannerIds: string[];
  gridModes: Record<string, GridMode>;
}

export interface UsePlateAssignmentsResult {
  assignmentsByScanner: Record<string, PlateAssignment[]>;
  /** True once a `GraviExperimentWaveMetadata` link was found for the
   * current wave (even if its accession has zero plates). */
  isGraviMetadata: boolean;
  /** No link exists at all for the current wave — manual entry. */
  waveMissingMetadata: boolean;
  /** A link exists, but its accession has zero `GraviPlateAccession` rows —
   * distinguished from `waveMissingMetadata` so an operator can tell an
   * intentionally-manual wave apart from a likely misconfigured link. */
  waveLinkedButEmpty: boolean;
  loadError: string | null;
  updateField: (
    scannerId: string,
    plateIndex: string,
    field: 'plantBarcode' | 'transplantDate' | 'customNote',
    value: string | null
  ) => void;
  toggleSelected: (scannerId: string, plateIndex: string) => void;
}

interface LoadedPlate {
  plate_id: string;
  transplant_date: string | null;
  custom_note: string | null;
}

interface PersistedRow {
  plate_index: string;
  plate_barcode: string | null;
  transplant_date: string | null;
  custom_note: string | null;
  selected: boolean;
}

function fieldsEqual(
  a: Pick<PlateAssignment, 'plantBarcode' | 'transplantDate' | 'customNote' | 'selected'>,
  b: Pick<PlateAssignment, 'plantBarcode' | 'transplantDate' | 'customNote' | 'selected'>
): boolean {
  return (
    a.plantBarcode === b.plantBarcode &&
    a.transplantDate === b.transplantDate &&
    a.customNote === b.customNote &&
    a.selected === b.selected
  );
}

/**
 * Wave-scoped plate assignment state for the Capture Scan screen
 * (design.md Decision 3). Each wave reads and writes its own,
 * independently-persisted `GraviScanPlateAssignment` row per position —
 * "which wave's data" is an explicit parameter on every call, not
 * inferred from render history, eliminating the remount-vs-wave-switch
 * ambiguity two prior review rounds each found a bug in.
 */
export function usePlateAssignments(
  params: UsePlateAssignmentsParams
): UsePlateAssignmentsResult {
  const { experimentId, waveNumber, scannerIds, gridModes } = params;

  const [assignmentsByScanner, setAssignmentsByScanner] = useState<
    Record<string, PlateAssignment[]>
  >({});
  const [isGraviMetadata, setIsGraviMetadata] = useState(false);
  const [waveMissingMetadata, setWaveMissingMetadata] = useState(false);
  const [waveLinkedButEmpty, setWaveLinkedButEmpty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Available plates for the current wave, distributed across scanners in
   * assignment order — kept for the manual-barcode-entry re-lookup
   * (updateField) so it can match against the same list auto-fill used. */
  const availablePlatesRef = useRef<LoadedPlate[]>([]);

  // Out-of-order async response guard (design.md Decision 3, point 5): a
  // stale fetch issued for a wave the operator has since navigated away
  // from must not overwrite a newer, already-rendered wave's state.
  const requestIdRef = useRef(0);

  const scannerIdsKey = scannerIds.join(',');
  const gridModesKey = scannerIds.map((id) => gridModes[id]).join(',');

  useEffect(() => {
    const thisRequestId = ++requestIdRef.current;

    if (!experimentId) {
      setAssignmentsByScanner(
        Object.fromEntries(
          scannerIds.map((id) => [id, createPlateAssignments(gridModes[id])])
        )
      );
      setIsGraviMetadata(false);
      setWaveMissingMetadata(false);
      setWaveLinkedButEmpty(false);
      setLoadError(null);
      return;
    }

    (async () => {
      let links: Array<{ wave_number: number; accession_id: string }>;
      try {
        const linksResult =
          await window.electron.database.experiments.listGraviMetadata(
            experimentId
          );
        if (requestIdRef.current !== thisRequestId) return;
        if (!linksResult.success) {
          setLoadError(linksResult.error ?? 'Failed to load wave metadata');
          return;
        }
        links = linksResult.data;
      } catch (err) {
        if (requestIdRef.current !== thisRequestId) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        return;
      }

      const link = links.find((l) => l.wave_number === waveNumber);
      setLoadError(null);

      let availablePlates: LoadedPlate[] = [];
      if (link) {
        try {
          const platesResult =
            await window.electron.database.graviPlateAccessions.list(
              link.accession_id
            );
          if (requestIdRef.current !== thisRequestId) return;
          if (!platesResult.success) {
            setLoadError(platesResult.error ?? 'Failed to load plate metadata');
            return;
          }
          availablePlates = platesResult.data as unknown as LoadedPlate[];
        } catch (err) {
          if (requestIdRef.current !== thisRequestId) return;
          setLoadError(err instanceof Error ? err.message : String(err));
          return;
        }
      }

      availablePlatesRef.current = availablePlates;
      setIsGraviMetadata(!!link);
      setWaveMissingMetadata(!link);
      setWaveLinkedButEmpty(!!link && availablePlates.length === 0);

      // Distribute available plates across scanners in assignment order,
      // continuing the index from one scanner to the next.
      let plateCursor = 0;
      const nextAssignments: Record<string, PlateAssignment[]> = {};
      const toPersist: Record<string, PlateAssignment[]> = {};

      for (const scannerId of scannerIds) {
        const gridMode = gridModes[scannerId];
        const positions = createPlateAssignments(gridMode);

        let persistedRows: PersistedRow[] = [];
        try {
          const assignmentsResult =
            await window.electron.database.graviscanPlateAssignments.list(
              experimentId,
              scannerId,
              waveNumber
            );
          if (requestIdRef.current !== thisRequestId) return;
          if (assignmentsResult.success) {
            persistedRows = assignmentsResult.data as unknown as PersistedRow[];
          }
        } catch {
          // A persisted-assignment fetch failure for one scanner shouldn't
          // block the others — fall through with no persisted rows for it.
        }
        const persistedByIndex = new Map(
          persistedRows.map((r) => [r.plate_index, r])
        );

        const finalPositions: PlateAssignment[] = [];
        const toWrite: PlateAssignment[] = [];

        for (const position of positions) {
          const computed: PlateAssignment = link
            ? plateCursor < availablePlates.length
              ? (() => {
                  const plate = availablePlates[plateCursor];
                  plateCursor += 1;
                  return {
                    plateIndex: position.plateIndex,
                    plantBarcode: plate.plate_id,
                    transplantDate: plate.transplant_date,
                    customNote: plate.custom_note,
                    selected: true,
                  };
                })()
              : { ...position, selected: false }
            : { ...position };

          const persisted = persistedByIndex.get(position.plateIndex);
          if (persisted) {
            const persistedAsAssignment: PlateAssignment = {
              plateIndex: position.plateIndex,
              plantBarcode: persisted.plate_barcode,
              transplantDate: persisted.transplant_date,
              customNote: persisted.custom_note,
              selected: persisted.selected,
            };
            if (!fieldsEqual(persistedAsAssignment, computed)) {
              // Operator-overridden — leave it untouched.
              finalPositions.push(persistedAsAssignment);
              continue;
            }
          }
          // No persisted row yet, or it matches the fresh computation —
          // safe to (re-)populate with the computed value.
          finalPositions.push(computed);
          toWrite.push(computed);
        }

        nextAssignments[scannerId] = finalPositions;
        toPersist[scannerId] = toWrite;
      }

      if (requestIdRef.current !== thisRequestId) return;
      setAssignmentsByScanner(nextAssignments);

      // Write-through: persist the non-overridden positions' fresh values
      // so the next comparison (mount, re-fire, or remount) reads them
      // back as the baseline. Never includes verification_status/
      // previous_plate_barcode — those are owned by the verify-plates
      // flow (design.md Decision 3, point 6).
      for (const scannerId of scannerIds) {
        const toWrite = toPersist[scannerId];
        if (toWrite.length === 0) continue;
        void window.electron.database.graviscanPlateAssignments.upsertMany(
          experimentId,
          scannerId,
          toWrite.map((a) => ({
            plate_index: a.plateIndex,
            plate_barcode: a.plantBarcode,
            transplant_date: a.transplantDate,
            custom_note: a.customNote,
            selected: a.selected,
          })),
          waveNumber
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })().catch((err: any) => {
      if (requestIdRef.current !== thisRequestId) return;
      setLoadError(err instanceof Error ? err.message : String(err));
    });
  }, [experimentId, waveNumber, scannerIdsKey, gridModesKey]);

  const persistPosition = useCallback(
    (scannerId: string, assignment: PlateAssignment) => {
      if (!experimentId) return;
      void window.electron.database.graviscanPlateAssignments.upsertMany(
        experimentId,
        scannerId,
        [
          {
            plate_index: assignment.plateIndex,
            plate_barcode: assignment.plantBarcode,
            transplant_date: assignment.transplantDate,
            custom_note: assignment.customNote,
            selected: assignment.selected,
          },
        ],
        waveNumber
      );
    },
    [experimentId, waveNumber]
  );

  const updateField = useCallback(
    (
      scannerId: string,
      plateIndex: string,
      field: 'plantBarcode' | 'transplantDate' | 'customNote',
      value: string | null
    ) => {
      setAssignmentsByScanner((prev) => {
        const positions = prev[scannerId];
        if (!positions) return prev;
        const idx = positions.findIndex((p) => p.plateIndex === plateIndex);
        if (idx === -1) return prev;

        let updated: PlateAssignment = { ...positions[idx], [field]: value };

        // PR #223 fix: entering/changing a barcode triggers a
        // case-insensitive match against the currently-loaded plate list,
        // auto-populating transplantDate/customNote from the match. A
        // barcode with no match leaves those fields unchanged.
        if (field === 'plantBarcode' && value) {
          const match = availablePlatesRef.current.find(
            (p) => p.plate_id.toLowerCase() === value.toLowerCase()
          );
          if (match) {
            updated = {
              ...updated,
              transplantDate: match.transplant_date,
              customNote: match.custom_note,
            };
          }
        }

        const next = { ...prev, [scannerId]: [...positions] };
        next[scannerId][idx] = updated;
        persistPosition(scannerId, updated);
        return next;
      });
    },
    [persistPosition]
  );

  const toggleSelected = useCallback(
    (scannerId: string, plateIndex: string) => {
      setAssignmentsByScanner((prev) => {
        const positions = prev[scannerId];
        if (!positions) return prev;
        const idx = positions.findIndex((p) => p.plateIndex === plateIndex);
        if (idx === -1) return prev;

        const updated: PlateAssignment = {
          ...positions[idx],
          selected: !positions[idx].selected,
        };
        const next = { ...prev, [scannerId]: [...positions] };
        next[scannerId][idx] = updated;
        persistPosition(scannerId, updated);
        return next;
      });
    },
    [persistPosition]
  );

  return {
    assignmentsByScanner,
    isGraviMetadata,
    waveMissingMetadata,
    waveLinkedButEmpty,
    loadError,
    updateField,
    toggleSelected,
  };
}
