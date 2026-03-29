/**
 * useScannerStatus — Read-only hook for Scanning page.
 *
 * Loads scanner config from DB via graviscan:get-scanner-status IPC handler.
 * Subscribes to scanner-init-status events for real-time updates.
 * Does NOT use localStorage — DB is the sole source of truth.
 *
 * For scanner setup (detection, assignment, save), use useScannerConfig
 * on the Machine Config page.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  DetectedScanner,
  ScannerAssignment,
  GraviScanPlatformInfo,
} from '../../types/graviscan';

interface ScannerStatusEntry {
  scannerId: string;
  displayName: string;
  usbPort: string | null;
  gridMode: string;
  status: 'ready' | 'starting' | 'error' | 'dead' | 'disconnected';
  error?: string;
}

interface UseScannerStatusReturn {
  // Scanner data for scan session
  scannerAssignments: ScannerAssignment[];
  detectedScanners: DetectedScanner[];
  platformInfo: GraviScanPlatformInfo | null;
  resolution: number;
  setResolution: React.Dispatch<React.SetStateAction<number>>;
  resolutionRef: React.MutableRefObject<number>;

  // Status info
  scannerStatuses: ScannerStatusEntry[];
  isLoading: boolean;
  configSaved: boolean;
  sessionValidated: boolean;
  isValidating: boolean;
}

export function useScannerStatus(): UseScannerStatusReturn {
  const [scannerStatuses, setScannerStatuses] = useState<ScannerStatusEntry[]>(
    []
  );
  const [scannerAssignments, setScannerAssignments] = useState<
    ScannerAssignment[]
  >([]);
  const [detectedScanners, setDetectedScanners] = useState<DetectedScanner[]>(
    []
  );
  const [platformInfo, setPlatformInfo] =
    useState<GraviScanPlatformInfo | null>(null);
  const [resolution, setResolution] = useState(1200);
  const resolutionRef = useRef(1200);
  const [isLoading, setIsLoading] = useState(true);

  // Keep ref in sync
  useEffect(() => {
    resolutionRef.current = resolution;
  }, [resolution]);

  // Load scanner status and config from DB on mount
  const loadScannerData = useCallback(async () => {
    try {
      // Get platform info
      const platformResult = await window.electron.graviscan.getPlatformInfo();
      if (platformResult.success) {
        setPlatformInfo(platformResult);
      }

      // Get scanner statuses (from coordinator + DB)
      const statusResult = await window.electron.graviscan.getScannerStatus();
      if (statusResult.success && statusResult.scanners) {
        setScannerStatuses(statusResult.scanners);

        // Build scannerAssignments from DB data
        const assignments: ScannerAssignment[] = statusResult.scanners.map(
          (s: ScannerStatusEntry, i: number) => ({
            slot: `Scanner ${i + 1}`,
            scannerId: s.scannerId,
            usbPort: s.usbPort,
            gridMode: (s.gridMode as '2grid' | '4grid') || '4grid',
          })
        );
        setScannerAssignments(assignments);

        // Build detectedScanners from DB + validation
        const validateResult = await window.electron.graviscan.validateConfig();
        if (validateResult.success && validateResult.detectedScanners) {
          setDetectedScanners(validateResult.detectedScanners);
        }
      }

      // Get saved resolution from graviscan config
      const configResult = await window.electron.graviscan.getConfig();
      if (configResult.success && configResult.config) {
        setResolution(configResult.config.resolution);
        resolutionRef.current = configResult.config.resolution;
      }
    } catch (error) {
      console.error('[useScannerStatus] Failed to load scanner data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScannerData();
  }, [loadScannerData]);

  // Subscribe to real-time status updates
  useEffect(() => {
    const cleanup = window.electron.graviscan.onScannerInitStatus?.(
      (event: { scannerId: string; status: string; error?: string }) => {
        setScannerStatuses((prev) =>
          prev.map((s) =>
            s.scannerId === event.scannerId
              ? {
                  ...s,
                  status: event.status as ScannerStatusEntry['status'],
                  error: event.error,
                }
              : s
          )
        );
      }
    );
    return cleanup;
  }, []);

  const configSaved = scannerStatuses.length > 0;
  const sessionValidated = !isLoading;

  return {
    scannerAssignments,
    detectedScanners,
    platformInfo,
    resolution,
    setResolution,
    resolutionRef,
    scannerStatuses,
    isLoading,
    configSaved,
    sessionValidated,
    isValidating: isLoading,
  };
}
