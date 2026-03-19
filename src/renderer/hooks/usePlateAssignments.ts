import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  ScannerAssignment,
  PlateAssignment,
} from '../../types/graviscan';
import {
  createPlateAssignments,
  AvailablePlate,
} from '../../types/graviscan';

interface UsePlateAssignmentsParams {
  selectedExperiment: string;
  scannerAssignments: ScannerAssignment[];
  setScanError: React.Dispatch<React.SetStateAction<string | null>>;
}

export interface UsePlateAssignmentsReturn {
  scannerPlateAssignments: Record<string, PlateAssignment[]>;
  scannerPlateAssignmentsRef: React.MutableRefObject<Record<string, PlateAssignment[]>>;
  loadingPlateAssignments: boolean;
  availableBarcodes: string[];
  loadingBarcodes: boolean;
  barcodeGenotypes: Record<string, string | null>;
  isGraviMetadata: boolean;
  availablePlates: AvailablePlate[];
  handleTogglePlate: (scannerId: string, plateIndex: string) => void;
  handlePlateBarcode: (scannerId: string, plateIndex: string, barcode: string | null) => void;
}

export function usePlateAssignments({
  selectedExperiment,
  scannerAssignments,
  setScanError,
}: UsePlateAssignmentsParams): UsePlateAssignmentsReturn {
  // Plant barcodes from the selected experiment's accession
  const [availableBarcodes, setAvailableBarcodes] = useState<string[]>([]);
  const [loadingBarcodes, setLoadingBarcodes] = useState(false);
  // Map of barcode -> accession_name for display
  const [barcodeGenotypes, setBarcodeGenotypes] = useState<Record<string, string | null>>({});
  // Whether the current experiment uses GraviScan plate-level metadata (vs CylScan barcodes)
  const [isGraviMetadata, setIsGraviMetadata] = useState(false);
  // Available plates from GraviScan metadata (used when isGraviMetadata is true)
  const [availablePlates, setAvailablePlates] = useState<AvailablePlate[]>([]);

  // Plate assignments per scanner - each scanner has its own plate assignments (stored in database)
  const [scannerPlateAssignments, setScannerPlateAssignments] = useState<Record<string, PlateAssignment[]>>({});
  const [loadingPlateAssignments, setLoadingPlateAssignments] = useState(false);

  // Ref for stable event callback access
  const scannerPlateAssignmentsRef = useRef(scannerPlateAssignments);

  // Keep ref in sync
  useEffect(() => { scannerPlateAssignmentsRef.current = scannerPlateAssignments; }, [scannerPlateAssignments]);

  // Derived value
  const assignedScannerIds = scannerAssignments
    .filter((a) => a.scannerId !== null)
    .map((a) => a.scannerId as string);

  // Reset plate assignments when scanner assignments change (including per-scanner grid mode)
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

    // If experiment is selected, save the new defaults to database for each scanner
    if (selectedExperiment && assignedScannerIds.length > 0) {
      scannerAssignments.forEach((assignment) => {
        if (assignment.scannerId) {
          const scannerGridMode = assignment.gridMode || '2grid';
          const defaultAssignments = createPlateAssignments(scannerGridMode);
          window.electron.database.graviscanPlateAssignments.upsertMany(
            selectedExperiment,
            assignment.scannerId,
            defaultAssignments.map((a) => ({
              plate_index: a.plateIndex,
              plate_barcode: a.plantBarcode,
              selected: a.selected,
            }))
          ).catch((err) => console.error('Failed to save plate assignments after grid mode change:', err));
        }
      });
    }
  }, [scannerAssignments, selectedExperiment]);

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

      try {
        // First get the experiment to find its accession
        const expResult = await window.electron.database.experiments.get(selectedExperiment);
        console.log('[GraviScan] Experiment data:', expResult.data);

        if (!expResult.success || !expResult.data || !expResult.data.accession_id) {
          console.log('[GraviScan] No accession linked to experiment');
          setAvailableBarcodes([]);
          setBarcodeGenotypes({});
          setIsGraviMetadata(false);
          setAvailablePlates([]);
        } else {
          const accessionId = expResult.data.accession_id;
          console.log('[GraviScan] Fetching mappings for accession:', accessionId);

          // Try CylScan mappings first (PlantAccessionMappings)
          const mappingsResult = await window.electron.database.accessions.getMappings(accessionId);

          if (mappingsResult.success && mappingsResult.data && mappingsResult.data.length > 0) {
            // CylScan metadata — plant_barcode + accession_name
            setIsGraviMetadata(false);
            setAvailablePlates([]);

            const barcodes = mappingsResult.data.map((m: { plant_barcode: string }) => m.plant_barcode);
            setAvailableBarcodes(barcodes);

            const genotypeMap: Record<string, string | null> = {};
            mappingsResult.data.forEach((m: { plant_barcode: string; accession_name: string | null }) => {
              genotypeMap[m.plant_barcode] = m.accession_name;
            });
            setBarcodeGenotypes(genotypeMap);
          } else {
            // Try GraviScan metadata — plate-level assignment
            const platesResult = await window.electron.database.graviPlateAccessions.list(accessionId);

            if (platesResult.success && platesResult.data && platesResult.data.length > 0) {
              setIsGraviMetadata(true);

              // Build plate metadata for dropdown
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const plates: AvailablePlate[] = platesResult.data.map((plate: any) => ({
                id: plate.id,
                plate_id: plate.plate_id,
                accession: plate.accession,
                custom_note: plate.custom_note ?? null,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                sectionCount: new Set((plate.sections || []).map((s: any) => s.plate_section_id)).size,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                plantQrCodes: (plate.sections || []).map((s: any) => s.plant_qr),
              }));
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
          const scannerAssignment = scannerAssignments.find((a) => a.scannerId === scannerId);
          const scannerGridMode = scannerAssignment?.gridMode || '2grid';
          const defaultAssignments = createPlateAssignments(scannerGridMode);

          const assignmentsResult = await window.electron.database.graviscanPlateAssignments.list(
            selectedExperiment,
            scannerId
          );

          if (assignmentsResult.success && assignmentsResult.data && assignmentsResult.data.length > 0) {
            // Convert database records to PlateAssignment format
            const dbAssignments: PlateAssignment[] = assignmentsResult.data.map((a) => ({
              plateIndex: a.plate_index,
              plantBarcode: a.plate_barcode,
              transplantDate: a.transplant_date ? new Date(a.transplant_date).toISOString().split('T')[0] : null,
              customNote: a.custom_note ?? null,
              selected: a.selected,
            }));

            // Merge with default assignments for current grid mode (in case grid mode changed)
            const mergedAssignments = defaultAssignments.map((defaultA) => {
              const dbMatch = dbAssignments.find((db) => db.plateIndex === defaultA.plateIndex);
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

        setScannerPlateAssignments(newScannerAssignments);
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

  // Toggle plate selection and save to database (per scanner)
  const handleTogglePlate = useCallback((scannerId: string, plateIndex: string) => {
    setScannerPlateAssignments((prev) => {
      const assignments = prev[scannerId] || [];
      const updated = assignments.map((p) =>
        p.plateIndex === plateIndex ? { ...p, selected: !p.selected } : p
      );

      // Save to database if experiment is selected
      if (selectedExperiment) {
        const assignment = updated.find((p) => p.plateIndex === plateIndex);
        if (assignment) {
          window.electron.database.graviscanPlateAssignments.upsert(
            selectedExperiment,
            scannerId,
            plateIndex,
            { selected: assignment.selected }
          ).catch((err) => console.error('Failed to save plate selection:', err));
        }
      }

      return { ...prev, [scannerId]: updated };
    });
  }, [selectedExperiment]);

  // Assign plant barcode to a plate and save to database (per scanner)
  const handlePlateBarcode = useCallback((scannerId: string, plateIndex: string, barcode: string | null) => {
    // Prevent assigning the same barcode to multiple slots
    if (barcode) {
      const allAssignments = Object.entries(scannerPlateAssignments).flatMap(
        ([sid, plates]) => plates.map((p) => ({ scannerId: sid, ...p }))
      );
      const existing = allAssignments.find(
        (a) => a.plantBarcode === barcode && !(a.scannerId === scannerId && a.plateIndex === plateIndex)
      );
      if (existing) {
        setScanError(`Barcode "${barcode}" is already assigned to plate ${existing.plateIndex}`);
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
        window.electron.database.graviscanPlateAssignments.upsert(
          selectedExperiment,
          scannerId,
          plateIndex,
          { plate_barcode: barcode }
        ).then((result) => {
          console.log('[GraviScan] Upsert response:', result);
        }).catch((err) => console.error('Failed to save plate barcode:', err));
      }

      return { ...prev, [scannerId]: updated };
    });
  }, [selectedExperiment, scannerPlateAssignments, setScanError]);

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
