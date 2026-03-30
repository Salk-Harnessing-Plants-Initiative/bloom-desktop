import { useState, useEffect, useCallback, useRef } from 'react';
import type { ScannerAssignment, PlateAssignment } from '../../types/graviscan';
import { createPlateAssignments, AvailablePlate } from '../../types/graviscan';
import type { GraviPlateAccessionWithSections } from '../../types/graviscan-store';
import { useToast } from '../contexts/ToastContext';

interface UsePlateAssignmentsParams {
  selectedExperiment: string;
  scannerAssignments: ScannerAssignment[];
  setScanError: React.Dispatch<React.SetStateAction<string | null>>;
}

export interface UsePlateAssignmentsReturn {
  scannerPlateAssignments: Record<string, PlateAssignment[]>;
  scannerPlateAssignmentsRef: React.MutableRefObject<
    Record<string, PlateAssignment[]>
  >;
  loadingPlateAssignments: boolean;
  availableBarcodes: string[];
  loadingBarcodes: boolean;
  barcodeGenotypes: Record<string, string | null>;
  isGraviMetadata: boolean;
  availablePlates: AvailablePlate[];
  handleTogglePlate: (scannerId: string, plateIndex: string) => void;
  handlePlateBarcode: (
    scannerId: string,
    plateIndex: string,
    barcode: string | null
  ) => void;
}

export function usePlateAssignments({
  selectedExperiment,
  scannerAssignments,
  setScanError,
}: UsePlateAssignmentsParams): UsePlateAssignmentsReturn {
  const { showToast } = useToast();

  // Plant barcodes from the selected experiment's accession
  const [availableBarcodes, setAvailableBarcodes] = useState<string[]>([]);
  const [loadingBarcodes, setLoadingBarcodes] = useState(false);
  // Map of barcode -> accession_name for display
  const [barcodeGenotypes, setBarcodeGenotypes] = useState<
    Record<string, string | null>
  >({});
  // Whether the current experiment uses GraviScan plate-level metadata (vs CylScan barcodes)
  const [isGraviMetadata, setIsGraviMetadata] = useState(false);
  // Available plates from GraviScan metadata (used when isGraviMetadata is true)
  const [availablePlates, setAvailablePlates] = useState<AvailablePlate[]>([]);

  // Plate assignments per scanner - each scanner has its own plate assignments (stored in database)
  const [scannerPlateAssignments, setScannerPlateAssignments] = useState<
    Record<string, PlateAssignment[]>
  >({});
  const [loadingPlateAssignments, setLoadingPlateAssignments] = useState(false);

  // Ref for stable event callback access
  const scannerPlateAssignmentsRef = useRef(scannerPlateAssignments);

  // Keep ref in sync
  useEffect(() => {
    scannerPlateAssignmentsRef.current = scannerPlateAssignments;
  }, [scannerPlateAssignments]);

  // Derived value
  const assignedScannerIds = scannerAssignments
    .filter((a) => a.scannerId !== null)
    .map((a) => a.scannerId as string);

  // Reset plate assignments when scanner config changes (grid mode, scanner count)
  // NOT when experiment changes — experiment change is handled by loadExperimentData + auto-assign
  useEffect(() => {
    const newAssignments: Record<string, PlateAssignment[]> = {};

    scannerAssignments.forEach((assignment) => {
      if (assignment.scannerId) {
        const scannerGridMode = assignment.gridMode || '2grid';
        const defaultAssignments = createPlateAssignments(scannerGridMode);
        newAssignments[assignment.scannerId] = [...defaultAssignments];
      }
    });

    setScannerPlateAssignments(newAssignments);
  }, [scannerAssignments]);

  // Load plant barcodes and plate assignments when experiment changes
  useEffect(() => {
    async function loadExperimentData() {
      if (!selectedExperiment) {
        setAvailableBarcodes([]);
        setBarcodeGenotypes({});
        setIsGraviMetadata(false);
        setAvailablePlates([]);
        setScannerPlateAssignments({});
        return;
      }

      setLoadingBarcodes(true);
      setLoadingPlateAssignments(true);
      let hasGraviMetadata = false;

      try {
        // First get the experiment to find its accession
        const expResult =
          await window.electron.database.experiments.get(selectedExperiment);
        console.log('[GraviScan] Experiment data:', expResult.data);

        if (
          !expResult.success ||
          !expResult.data ||
          !expResult.data.accession_id
        ) {
          console.log('[GraviScan] No accession linked to experiment');
          setAvailableBarcodes([]);
          setBarcodeGenotypes({});
          setIsGraviMetadata(false);
          setAvailablePlates([]);
        } else {
          const accessionId = expResult.data.accession_id;
          console.log(
            '[GraviScan] Fetching mappings for accession:',
            accessionId
          );

          // Try CylScan mappings first (PlantAccessionMappings)
          const mappingsResult =
            await window.electron.database.accessions.getMappings(accessionId);

          if (
            mappingsResult.success &&
            mappingsResult.data &&
            mappingsResult.data.length > 0
          ) {
            // CylScan metadata — plant_barcode + accession_name
            setIsGraviMetadata(false);
            setAvailablePlates([]);

            const barcodes = mappingsResult.data.map(
              (m: { plant_barcode: string }) => m.plant_barcode
            );
            setAvailableBarcodes(barcodes);

            const genotypeMap: Record<string, string | null> = {};
            mappingsResult.data.forEach(
              (m: { plant_barcode: string; accession_name: string | null }) => {
                genotypeMap[m.plant_barcode] = m.accession_name;
              }
            );
            setBarcodeGenotypes(genotypeMap);
          } else {
            // Try GraviScan metadata — plate-level assignment
            const platesResult =
              await window.electron.database.graviPlateAccessions.list(
                accessionId
              );

            if (
              platesResult.success &&
              platesResult.data &&
              platesResult.data.length > 0
            ) {
              setIsGraviMetadata(true);
              hasGraviMetadata = true;

              // Build plate metadata for dropdown
              const plates: AvailablePlate[] = platesResult.data.map(
                (plate: GraviPlateAccessionWithSections) => ({
                  id: plate.id,
                  plate_id: plate.plate_id,
                  accession: plate.accession,
                  custom_note: plate.custom_note ?? null,
                  sectionCount: new Set(
                    (plate.sections || []).map((s) => s.plate_section_id)
                  ).size,
                  plantQrCodes: (plate.sections || []).map((s) => s.plant_qr),
                })
              );
              setAvailablePlates(plates);

              // Populate availableBarcodes with plate_ids for backward compat
              // (used by selectedPlatesWithBarcodes count and handlePlateBarcode)
              const plateIds = plates.map((p) => p.plate_id);
              setAvailableBarcodes(plateIds);

              // Map plate_id → accession for genotype display slot
              const genotypeMap: Record<string, string | null> = {};
              plates.forEach((p) => {
                genotypeMap[p.plate_id] = p.accession;
              });
              setBarcodeGenotypes(genotypeMap);
            } else {
              setIsGraviMetadata(false);
              setAvailablePlates([]);
              setAvailableBarcodes([]);
              setBarcodeGenotypes({});
            }
          }
        }

        // Load plate assignments from database for each assigned scanner
        const newScannerAssignments: Record<string, PlateAssignment[]> = {};

        for (const scannerId of assignedScannerIds) {
          // Get grid mode for this scanner from assignments
          const scannerAssignment = scannerAssignments.find(
            (a) => a.scannerId === scannerId
          );
          const scannerGridMode = scannerAssignment?.gridMode || '2grid';
          const defaultAssignments = createPlateAssignments(scannerGridMode);

          const assignmentsResult =
            await window.electron.database.graviscanPlateAssignments.list(
              selectedExperiment,
              scannerId
            );

          if (
            assignmentsResult.success &&
            assignmentsResult.data &&
            assignmentsResult.data.length > 0
          ) {
            // Convert database records to PlateAssignment format
            const dbAssignments: PlateAssignment[] = assignmentsResult.data.map(
              (a) => ({
                plateIndex: a.plate_index,
                plantBarcode: a.plate_barcode,
                transplantDate: a.transplant_date
                  ? new Date(a.transplant_date).toISOString().split('T')[0]
                  : null,
                customNote: a.custom_note ?? null,
                selected: a.selected,
              })
            );

            // Merge with default assignments for current grid mode (in case grid mode changed)
            const mergedAssignments = defaultAssignments.map((defaultA) => {
              const dbMatch = dbAssignments.find(
                (db) => db.plateIndex === defaultA.plateIndex
              );
              return dbMatch || defaultA;
            });

            newScannerAssignments[scannerId] = mergedAssignments;
          } else {
            // No existing assignments, create defaults and save to database
            newScannerAssignments[scannerId] = [...defaultAssignments];

            // Save defaults to database
            await window.electron.database.graviscanPlateAssignments.upsertMany(
              selectedExperiment,
              scannerId,
              defaultAssignments.map((a) => ({
                plate_index: a.plateIndex,
                plate_barcode: a.plantBarcode,
                selected: a.selected,
              }))
            );
          }
        }

        // Only set assignments from DB if NOT using GraviScan metadata
        // (auto-assign effect handles GraviScan plate assignments)
        if (!hasGraviMetadata) {
          setScannerPlateAssignments(newScannerAssignments);
        }
      } catch (error) {
        console.error('Failed to load experiment data:', error);
        setAvailableBarcodes([]);
        setBarcodeGenotypes({});
        setIsGraviMetadata(false);
        setAvailablePlates([]);
        setScannerPlateAssignments({});
      } finally {
        setLoadingBarcodes(false);
        setLoadingPlateAssignments(false);
      }
    }

    loadExperimentData();
  }, [selectedExperiment, scannerAssignments]);

  // Auto-assign plates from GraviScan metadata to scanner grid positions
  // First-come-first-served by metadata row order, sorted across scanners
  useEffect(() => {
    if (!isGraviMetadata || availablePlates.length === 0) return;
    if (assignedScannerIds.length === 0) return;

    // Check for duplicate plate_ids
    const plateIds = availablePlates.map((p) => p.plate_id);
    const duplicates = plateIds.filter((id, i) => plateIds.indexOf(id) !== i);
    if (duplicates.length > 0) {
      showToast({
        type: 'error',
        message: `Duplicate plate ID: ${duplicates[0]}. Fix metadata before scanning.`,
      });
      return;
    }

    // Build auto-assignments: iterate scanners in order, fill grid positions
    const newAssignments: Record<string, PlateAssignment[]> = {};
    let plateIndex = 0;
    const totalPositions = assignedScannerIds.reduce((sum, sid) => {
      const assignment = scannerAssignments.find((a) => a.scannerId === sid);
      const gridMode = assignment?.gridMode || '4grid';
      return sum + (gridMode === '4grid' ? 4 : 2);
    }, 0);

    for (const scannerId of assignedScannerIds) {
      const assignment = scannerAssignments.find(
        (a) => a.scannerId === scannerId
      );
      const gridMode = assignment?.gridMode || '4grid';
      const positions = createPlateAssignments(gridMode);

      newAssignments[scannerId] = positions.map((pos) => {
        if (plateIndex < availablePlates.length) {
          const plate = availablePlates[plateIndex];
          plateIndex++;
          return {
            ...pos,
            plantBarcode: plate.plate_id,
            selected: true,
          };
        }
        return { ...pos, selected: false }; // empty position
      });
    }

    setScannerPlateAssignments(newAssignments);

    // Save auto-assignments to database
    if (selectedExperiment) {
      for (const scannerId of assignedScannerIds) {
        const assignments = newAssignments[scannerId];
        if (assignments) {
          window.electron.database.graviscanPlateAssignments
            .upsertMany(
              selectedExperiment,
              scannerId,
              assignments.map((a) => ({
                plate_index: a.plateIndex,
                plate_barcode: a.plantBarcode,
                selected: a.selected,
              }))
            )
            .catch((err) =>
              console.error('Failed to save auto-assignments:', err)
            );
        }
      }
    }

    // Show toast notifications
    const assignedCount = Math.min(availablePlates.length, totalPositions);
    const scannerCount = assignedScannerIds.length;

    if (availablePlates.length > totalPositions) {
      // Overflow
      const unassigned = availablePlates.slice(totalPositions);
      const unassignedNames = unassigned
        .map((p) => p.plate_id)
        .slice(0, 5)
        .join(', ');
      const more =
        unassigned.length > 5 ? ` +${unassigned.length - 5} more` : '';
      showToast({
        type: 'warning',
        message: `${assignedCount} of ${availablePlates.length} plates assigned to ${scannerCount} scanner(s). ${unassigned.length} not assigned: ${unassignedNames}${more}`,
        duration: 20000,
      });
    } else {
      showToast({
        type: 'info',
        message: `${assignedCount} plate(s) assigned to ${scannerCount} scanner(s). Please place plates on the correct grid positions before scanning.`,
        duration: 15000,
      });
    }
  }, [
    isGraviMetadata,
    availablePlates,
    scannerAssignments,
    selectedExperiment,
  ]);

  // Toggle plate selection and save to database (per scanner)
  const handleTogglePlate = useCallback(
    (scannerId: string, plateIndex: string) => {
      setScannerPlateAssignments((prev) => {
        const assignments = prev[scannerId] || [];
        const updated = assignments.map((p) =>
          p.plateIndex === plateIndex ? { ...p, selected: !p.selected } : p
        );

        // Save to database if experiment is selected
        if (selectedExperiment) {
          const assignment = updated.find((p) => p.plateIndex === plateIndex);
          if (assignment) {
            window.electron.database.graviscanPlateAssignments
              .upsert(selectedExperiment, scannerId, plateIndex, {
                selected: assignment.selected,
              })
              .catch((err) =>
                console.error('Failed to save plate selection:', err)
              );
          }
        }

        return { ...prev, [scannerId]: updated };
      });
    },
    [selectedExperiment]
  );

  // Assign plant barcode to a plate and save to database (per scanner)
  const handlePlateBarcode = useCallback(
    (scannerId: string, plateIndex: string, barcode: string | null) => {
      // Prevent assigning the same barcode to multiple slots
      if (barcode) {
        const allAssignments = Object.entries(scannerPlateAssignments).flatMap(
          ([sid, plates]) => plates.map((p) => ({ scannerId: sid, ...p }))
        );
        const existing = allAssignments.find(
          (a) =>
            a.plantBarcode === barcode &&
            !(a.scannerId === scannerId && a.plateIndex === plateIndex)
        );
        if (existing) {
          setScanError(
            `Barcode "${barcode}" is already assigned to plate ${existing.plateIndex}`
          );
          return;
        }
      }

      setScannerPlateAssignments((prev) => {
        const assignments = prev[scannerId] || [];
        const updated = assignments.map((p) =>
          p.plateIndex === plateIndex ? { ...p, plantBarcode: barcode } : p
        );

        // Save to database if experiment is selected
        if (selectedExperiment) {
          window.electron.database.graviscanPlateAssignments
            .upsert(selectedExperiment, scannerId, plateIndex, {
              plate_barcode: barcode,
            })
            .then((result) => {
              console.log('[GraviScan] Upsert response:', result);
            })
            .catch((err) =>
              console.error('Failed to save plate barcode:', err)
            );
        }

        return { ...prev, [scannerId]: updated };
      });
    },
    [selectedExperiment, scannerPlateAssignments, setScanError]
  );

  return {
    scannerPlateAssignments,
    scannerPlateAssignmentsRef,
    loadingPlateAssignments,
    availableBarcodes,
    loadingBarcodes,
    barcodeGenotypes,
    isGraviMetadata,
    availablePlates,
    handleTogglePlate,
    handlePlateBarcode,
  };
}
