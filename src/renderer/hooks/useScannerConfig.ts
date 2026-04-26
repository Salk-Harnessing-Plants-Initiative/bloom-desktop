import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  DetectedScanner,
  GraviConfig,
  GraviScanner,
  GraviScanPlatformInfo,
  ScannerAssignment,
} from '../../types/graviscan';
import {
  DEFAULT_SCANNER_SLOTS,
  MAX_SCANNER_SLOTS,
  generateScannerSlots,
  createEmptyScannerAssignment,
} from '../../types/graviscan';

// LocalStorage keys for scanner configuration
const STORAGE_KEYS = {
  detectedScanners: 'graviscan:detectedScanners',
  scannerAssignments: 'graviscan:scannerAssignments',
  resolution: 'graviscan:resolution',
  configCollapsed: 'graviscan:configCollapsed',
  isConfigured: 'graviscan:isConfigured',
  sessionValidated: 'graviscan:sessionValidated',
  // Task 2.2: unchecked-state memory keyed by stable physical identity
  uncheckedScannerKeys: 'graviscan:uncheckedScannerKeys',
};

/**
 * Compute the stable-identity key for a scanner.
 * Primary: usb_port (stable across USB reconnects).
 * Fallback: composite — distinguishes identical-model scanners on the same hub
 * when usb_port is empty. Uses `!usb_port` predicate since DetectedScanner.usb_port
 * is typed string and can be '' (empty) when platform info is missing.
 */
export function computeStableKey(s: {
  usb_port?: string;
  vendor_id: string;
  product_id: string;
  name: string;
  usb_bus?: number;
  usb_device?: number;
}): string {
  if (s.usb_port) return s.usb_port;
  return `${s.vendor_id}:${s.product_id}:${s.name}:${s.usb_bus ?? ''}:${s.usb_device ?? ''}`;
}

function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored);
  } catch {
    /* ignore */
  }
  return defaultValue;
}

function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export type ConfigStatus =
  | 'loading'
  | 'valid'
  | 'mismatch'
  | 'no-config'
  | 'error';

export interface UseScannerConfigReturn {
  // Platform
  platformInfo: GraviScanPlatformInfo | null;
  platformLoading: boolean;

  // Scanner detection
  detectedScanners: DetectedScanner[];
  detectingScanner: boolean;
  detectionError: string | null;

  // Scanner assignments
  scannerAssignments: ScannerAssignment[];

  // Config
  config: GraviConfig | null;
  resolution: number;
  setResolution: React.Dispatch<React.SetStateAction<number>>;
  configSaved: boolean;
  isConfigCollapsed: boolean;

  // Validation
  sessionValidated: boolean;
  isValidating: boolean;
  validationWarning: string | null;
  configStatus: ConfigStatus;
  configValidationMessage: string;
  missingScanners: GraviScanner[];
  newScanners: DetectedScanner[];
  matchedScanners: Array<{ saved: GraviScanner; detected: DetectedScanner }>;

  // Ref
  resolutionRef: React.MutableRefObject<number>;

  // Handlers
  handleDetectScanners: () => Promise<void>;
  handleResetScannerConfig: (e: React.MouseEvent) => Promise<void>;
  handleScannerAssignment: (
    slotIndex: number,
    scannerId: string | null
  ) => void;
  handleScannerGridMode: (
    slotIndex: number,
    gridMode: '2grid' | '4grid'
  ) => void;
  handleAddScannerSlot: () => void;
  handleRemoveScannerSlot: (slotIndex: number) => void;
  handleToggleConfigCollapse: () => void;
  clearValidationWarning: () => void;
}

export function useScannerConfig(): UseScannerConfigReturn {
  // Platform support
  const [platformInfo, setPlatformInfo] =
    useState<GraviScanPlatformInfo | null>(null);
  const [platformLoading, setPlatformLoading] = useState(true);

  // Scanner detection - initialize from localStorage
  const [detectedScanners, setDetectedScanners] = useState<DetectedScanner[]>(
    () => loadFromStorage(STORAGE_KEYS.detectedScanners, [])
  );
  const [detectingScanner, setDetectingScanner] = useState(false);
  const [detectionError, setDetectionError] = useState<string | null>(null);

  // Scanner assignments - maps slot names to detected scanners
  const [scannerAssignments, setScannerAssignments] = useState<
    ScannerAssignment[]
  >(() => {
    const stored = loadFromStorage<ScannerAssignment[]>(
      STORAGE_KEYS.scannerAssignments,
      []
    );
    if (stored.length > 0) return stored;
    return generateScannerSlots(DEFAULT_SCANNER_SLOTS).map((_slot, index) =>
      createEmptyScannerAssignment(index)
    );
  });

  // Configuration - initialize from localStorage
  const [config, setConfig] = useState<GraviConfig | null>(null);
  const [resolution, setResolution] = useState<number>(() =>
    loadFromStorage(STORAGE_KEYS.resolution, 1200)
  );
  const [configSaved, setConfigSaved] = useState(() =>
    loadFromStorage(STORAGE_KEYS.isConfigured, false)
  );

  // Collapsible Configure Scanners section - auto-collapse if already configured
  const [isConfigCollapsed, setIsConfigCollapsed] = useState(() => {
    const savedCollapsed = loadFromStorage(STORAGE_KEYS.configCollapsed, false);
    const isAlreadyConfigured = loadFromStorage(
      STORAGE_KEYS.isConfigured,
      false
    );
    return isAlreadyConfigured || savedCollapsed;
  });

  // Session validation - must detect scanners each session before scanning
  const [sessionValidated, setSessionValidated] = useState(() =>
    loadFromStorage(STORAGE_KEYS.sessionValidated, false)
  );

  // Background validation state
  const [isValidating, setIsValidating] = useState(false);
  const [validationWarning, setValidationWarning] = useState<string | null>(
    null
  );

  // Config validation state
  const [configStatus, setConfigStatus] = useState<ConfigStatus>('loading');
  const [configValidationMessage, setConfigValidationMessage] =
    useState<string>('Checking scanner configuration...');
  const [missingScanners, setMissingScanners] = useState<GraviScanner[]>([]);
  const [newScanners, setNewScanners] = useState<DetectedScanner[]>([]);
  const [matchedScanners, setMatchedScanners] = useState<
    Array<{ saved: GraviScanner; detected: DetectedScanner }>
  >([]);

  // Task 2.2: persisted unchecked-state memory (set of stable-identity keys).
  // Survives page reload, HMR, and navigation-away-and-back via localStorage.
  const uncheckedKeysRef = useRef<Set<string>>(
    new Set(loadFromStorage<string[]>(STORAGE_KEYS.uncheckedScannerKeys, []))
  );

  function writeUncheckedKeys(next: Set<string>) {
    uncheckedKeysRef.current = next;
    saveToStorage(STORAGE_KEYS.uncheckedScannerKeys, Array.from(next));
  }

  // Refs
  const resolutionRef = useRef(resolution);

  // --- Functions ---

  async function loadPlatformInfo() {
    try {
      setPlatformLoading(true);
      const result = await window.electron.gravi.getPlatformInfo();
      if (result.success) {
        setPlatformInfo({
          supported: result.supported,
          backend: result.backend,
          mock_enabled: result.mock_enabled,
        });
      }
    } catch (error) {
      console.error('Failed to load platform info:', error);
    } finally {
      setPlatformLoading(false);
    }
  }

  async function loadConfig() {
    try {
      const result = await window.electron.gravi.getConfig();
      if (result.success && result.config) {
        setConfig(result.config);
        setResolution(result.config.resolution);
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  }

  /**
   * Validate scanner configuration by matching saved USB ports with detected scanners.
   * Called on page load to determine if we can skip config setup or need reconfiguration.
   */
  async function validateScannerConfig() {
    try {
      setConfigStatus('loading');
      setConfigValidationMessage('Loading scanner configuration...');

      // Step 1: Load saved config
      setConfigValidationMessage('Detecting connected scanners...');

      // Step 2 & 3: Validate config (loads saved scanners, detects connected, matches by usb_port)
      const result = await window.electron.gravi.validateConfig();

      if (!result.success) {
        setConfigStatus('error');
        setConfigValidationMessage(
          result.error || 'Configuration validation failed'
        );
        return;
      }

      // Update state based on validation result
      setMatchedScanners(result.matched);
      setMissingScanners(result.missing);
      setNewScanners(result.new);

      switch (result.status) {
        case 'valid':
          setConfigStatus('valid');
          setConfigValidationMessage('Scanners ready');
          setDetectedScanners(result.detectedScanners);
          if (result.matched.length > 0) {
            const newAssignments: ScannerAssignment[] = result.matched.map(
              (
                m: { saved: GraviScanner; detected: DetectedScanner },
                index: number
              ) => {
                const existing = scannerAssignments.find(
                  (a) => a.scannerId === m.saved.id
                );
                return {
                  slot: `Scanner ${index + 1}`,
                  scannerId: m.saved.id,
                  usbPort: m.detected.usb_port,
                  gridMode: existing?.gridMode || '2grid',
                };
              }
            );
            setScannerAssignments(newAssignments);
            setConfigSaved(true);
            setIsConfigCollapsed(true);
            setSessionValidated(true);
          }
          break;

        case 'mismatch': {
          setConfigStatus('mismatch');
          const missingNames = result.missing
            .map((s: GraviScanner) => s.name)
            .join(', ');
          const newPorts = result.new
            .map((s: DetectedScanner) => s.usb_port)
            .join(', ');
          let message = 'Scanner configuration has changed. ';
          if (result.missing.length > 0) {
            message += `Missing: ${missingNames}. `;
          }
          if (result.new.length > 0) {
            message += `New scanners on ports: ${newPorts}.`;
          }
          setConfigValidationMessage(message);
          setDetectedScanners(result.detectedScanners);
          setIsConfigCollapsed(false);
          break;
        }

        case 'no-config':
          setConfigStatus('no-config');
          setConfigValidationMessage(
            'No scanner configuration found. Please configure scanners.'
          );
          setIsConfigCollapsed(false);
          // Kick off an initial detection so users see available scanners
          // on first visit without having to click "Detect Scanners".
          try {
            const detectResult = await window.electron.gravi.detectScanners();
            if (
              detectResult.success &&
              detectResult.scanners &&
              detectResult.scanners.length > 0
            ) {
              setDetectedScanners(detectResult.scanners);
              // Task 2.1: populate scannerAssignments on detection
              setScannerAssignments((prev) =>
                buildAssignmentsFromDetection(detectResult.scanners, prev)
              );
            }
          } catch (err) {
            console.error('Auto-detection after no-config failed:', err);
          }
          break;

        default:
          setConfigStatus('error');
          setConfigValidationMessage('Unknown validation status');
      }
    } catch (error) {
      console.error('Failed to validate scanner config:', error);
      setConfigStatus('error');
      setConfigValidationMessage(
        error instanceof Error ? error.message : 'Validation failed'
      );
    }
  }

  /**
   * Task 2.1: Build scannerAssignments from a detection result, applying the
   * persisted unchecked-state memory so unchecked scanners stay unchecked
   * across re-detection (and across USB reconnects that change usb_device).
   */
  function buildAssignmentsFromDetection(
    detected: DetectedScanner[],
    existingAssignments: ScannerAssignment[]
  ): ScannerAssignment[] {
    return detected.map((s, index) => {
      const key = computeStableKey(s);
      const isUnchecked = uncheckedKeysRef.current.has(key);
      // Reconciliation rule: a scanner is rendered as unchecked if EITHER
      // (a) the localStorage uncheckedScannerKeys map says so (user
      //     unchecked it in this or a previous session before saving), OR
      // (b) the DB row has `enabled: false` (user previously saved it
      //     unchecked).
      // `enabled === false` uses strict equality so unset/undefined is
      // treated as `true` (newly-discovered scanners default to checked).
      const isDisabledInDb = s.enabled === false;
      const existing = existingAssignments[index];
      // scanner_id may be `''` (sentinel for "not yet in DB"); treat as
      // unassigned so downstream consumers don't FK against a fake id.
      const id = s.scanner_id || null;
      return {
        slot: existing?.slot || `Scanner ${index + 1}`,
        scannerId: isUnchecked || isDisabledInDb ? null : id,
        usbPort: s.usb_port,
        gridMode: existing?.gridMode || '2grid',
      };
    });
  }

  async function handleDetectScanners() {
    setDetectingScanner(true);
    setDetectionError(null);
    setValidationWarning(null);
    setConfigStatus('valid');
    setConfigValidationMessage('');

    try {
      const result = await window.electron.gravi.detectScanners();
      if (result.success) {
        setDetectedScanners(result.scanners);
        if (result.scanners.length === 0) {
          setDetectionError('No scanners detected. Check USB connections.');
          setSessionValidated(false);
        } else {
          // Task 2.1: populate scannerAssignments on detection
          setScannerAssignments((prev) =>
            buildAssignmentsFromDetection(result.scanners, prev)
          );
          setSessionValidated(true);
        }
      } else {
        setDetectionError(result.error || 'Detection failed');
        setSessionValidated(false);
      }
    } catch (error) {
      setDetectionError(
        error instanceof Error ? error.message : 'Detection failed'
      );
      setSessionValidated(false);
    } finally {
      setDetectingScanner(false);
    }
  }

  function handleToggleConfigCollapse() {
    setIsConfigCollapsed((prev) => !prev);
  }

  async function handleResetScannerConfig(e: React.MouseEvent) {
    e.stopPropagation();

    // Clear scanner-related localStorage
    localStorage.removeItem(STORAGE_KEYS.detectedScanners);
    localStorage.removeItem(STORAGE_KEYS.scannerAssignments);
    localStorage.removeItem(STORAGE_KEYS.sessionValidated);
    localStorage.removeItem(STORAGE_KEYS.isConfigured);
    localStorage.removeItem(STORAGE_KEYS.configCollapsed);
    localStorage.removeItem(STORAGE_KEYS.uncheckedScannerKeys);

    // Reset state
    setDetectedScanners([]);
    setScannerAssignments([]);
    // Task 2.2: also clear persisted unchecked-state memory on full reset
    writeUncheckedKeys(new Set());
    setSessionValidated(false);
    setConfigSaved(false);
    setIsConfigCollapsed(false);
    setValidationWarning(null);
    setDetectionError(null);

    // Cancel any active scans and shut down scanner subprocesses
    try {
      await window.electron.gravi.cancelScan();
    } catch (error) {
      console.warn('Failed to cancel scan during reset:', error);
    }

    console.log('[GraviScan] Scanner configuration reset');
  }

  const handleScannerAssignment = useCallback(
    (slotIndex: number, scannerId: string | null) => {
      setScannerAssignments((prev) => {
        const updated = [...prev];
        const scanner = scannerId
          ? detectedScanners.find((s) => s.scanner_id === scannerId)
          : null;
        updated[slotIndex] = {
          ...updated[slotIndex],
          scannerId,
          usbPort: scanner?.usb_port || null,
        };
        return updated;
      });
      if (scannerId) {
        setConfigSaved(true);
      }

      // Task 2.2: update persisted unchecked-state memory SYNCHRONOUSLY.
      // Scanner at slotIndex is the detected scanner at the same index (1:1 mapping).
      const detected = detectedScanners[slotIndex];
      if (detected) {
        const key = computeStableKey(detected);
        const next = new Set(uncheckedKeysRef.current);
        if (scannerId === null) {
          next.add(key);
        } else {
          next.delete(key);
        }
        writeUncheckedKeys(next);
      }
    },
    [detectedScanners]
  );

  const handleScannerGridMode = useCallback(
    (slotIndex: number, gridMode: '2grid' | '4grid') => {
      setScannerAssignments((prev) => {
        const updated = [...prev];
        updated[slotIndex] = {
          ...updated[slotIndex],
          gridMode,
        };
        return updated;
      });
    },
    []
  );

  const handleAddScannerSlot = useCallback(() => {
    setScannerAssignments((prev) => {
      if (prev.length >= MAX_SCANNER_SLOTS) return prev;
      return [...prev, createEmptyScannerAssignment(prev.length)];
    });
  }, []);

  const handleRemoveScannerSlot = useCallback((slotIndex: number) => {
    setScannerAssignments((prev) => {
      if (prev.length <= 1) return prev;
      const updated = prev.filter((_, i) => i !== slotIndex);
      return updated.map((assignment, i) => ({
        ...assignment,
        slot: `Scanner ${i + 1}`,
      }));
    });
  }, []);

  // --- Effects ---

  // Load config and validate on mount
  useEffect(() => {
    loadPlatformInfo();
    loadConfig();
    validateScannerConfig();
  }, []);

  // Keep resolutionRef in sync
  useEffect(() => {
    resolutionRef.current = resolution;
  }, [resolution]);

  // Persist detected scanners to localStorage
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.detectedScanners, detectedScanners);
  }, [detectedScanners]);

  // Persist scanner assignments to localStorage
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.scannerAssignments, scannerAssignments);
  }, [scannerAssignments]);

  // Auto-save scanner assignments to database when they change.
  // Task 2.3: build payload from scannerAssignments (now correctly populated on detection).
  useEffect(() => {
    const assignedScanners = scannerAssignments
      .filter((a) => a.scannerId !== null)
      .map((a) => detectedScanners.find((s) => s.scanner_id === a.scannerId))
      .filter((s): s is DetectedScanner => s !== undefined);

    if (assignedScanners.length === 0) return;

    const timeoutId = setTimeout(async () => {
      try {
        const firstAssigned = scannerAssignments.find(
          (a) => a.scannerId !== null
        );
        await window.electron.gravi.saveConfig({
          grid_mode: firstAssigned?.gridMode || '2grid',
          resolution: resolution,
        });

        const scannersToSave = assignedScanners.map((s) => ({
          name: s.name,
          // display_name: undefined → main-process upsert preserves admin-chosen value via `?? existing.display_name`
          display_name: undefined as string | undefined,
          vendor_id: s.vendor_id,
          product_id: s.product_id,
          usb_port: s.usb_port,
          usb_bus: s.usb_bus,
          usb_device: s.usb_device,
        }));

        const saveResult =
          await window.electron.gravi.saveScannersToDB(scannersToSave);
        if (saveResult.success && saveResult.scanners) {
          console.log('[GraviScan] Auto-saved scanner configuration');
          setConfigSaved(true);

          // Task 2.3: also disable scanners missing from the enabled list
          try {
            const enabledIdentities = assignedScanners.map((s) => ({
              usb_port: s.usb_port,
              vendor_id: s.vendor_id,
              product_id: s.product_id,
              name: s.name,
              usb_bus: s.usb_bus,
              usb_device: s.usb_device,
            }));
            await window.electron.gravi.disableMissingScanners(
              enabledIdentities
            );
          } catch (err) {
            console.error(
              '[GraviScan] disableMissingScanners failed during auto-save:',
              err
            );
          }

          const savedScanners = saveResult.scanners as Array<{
            id: string;
            usb_bus: number | null;
            usb_device: number | null;
            name: string;
          }>;
          const idUpdates = new Map<string, string>();
          for (const saved of savedScanners) {
            const tempId = `new:${saved.usb_bus}:${saved.usb_device}`;
            const matched = assignedScanners.find(
              (s) =>
                s.scanner_id === tempId ||
                (s.usb_bus === saved.usb_bus &&
                  s.usb_device === saved.usb_device)
            );
            if (matched && matched.scanner_id !== saved.id) {
              idUpdates.set(matched.scanner_id, saved.id);
            }
          }
          if (idUpdates.size > 0) {
            setDetectedScanners((prev) =>
              prev.map((s) =>
                idUpdates.has(s.scanner_id)
                  ? { ...s, scanner_id: idUpdates.get(s.scanner_id)! }
                  : s
              )
            );
            setScannerAssignments((prev) =>
              prev.map((a) =>
                a.scannerId && idUpdates.has(a.scannerId)
                  ? { ...a, scannerId: idUpdates.get(a.scannerId)! }
                  : a
              )
            );
          }
        }
      } catch (error) {
        console.error('[GraviScan] Auto-save failed:', error);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
    // Note: detectedScanners intentionally excluded — detection alone shouldn't trigger saves.
  }, [scannerAssignments, resolution]);

  // Persist resolution to localStorage
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.resolution, resolution);
  }, [resolution]);

  // Persist collapsed state to localStorage
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.configCollapsed, isConfigCollapsed);
  }, [isConfigCollapsed]);

  // Persist configured state to localStorage
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.isConfigured, configSaved);
  }, [configSaved]);

  // Persist session validated state to localStorage
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.sessionValidated, sessionValidated);
  }, [sessionValidated]);

  // Reset session validation when app window closes
  useEffect(() => {
    function handleBeforeUnload() {
      localStorage.setItem(STORAGE_KEYS.sessionValidated, 'false');
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Validate cached scanners via main process on mount (background validation)
  useEffect(() => {
    async function validateCachedScanners() {
      const alreadyValidated = loadFromStorage<boolean>(
        STORAGE_KEYS.sessionValidated,
        false
      );
      if (alreadyValidated) return;

      const cachedScanners = loadFromStorage<DetectedScanner[]>(
        STORAGE_KEYS.detectedScanners,
        []
      );
      if (cachedScanners.length === 0) return;

      const cachedScannerIds = cachedScanners
        .filter((s) => s.is_available)
        .map((s) => s.scanner_id);

      setIsValidating(true);
      setValidationWarning(null);

      try {
        const result =
          await window.electron.gravi.validateScanners(cachedScannerIds);

        if (result.isValidated) {
          setDetectedScanners(result.detectedScanners);
          setSessionValidated(true);
        } else if (result.detectedScanners.length > 0) {
          const cachedAssignments = loadFromStorage<ScannerAssignment[]>(
            STORAGE_KEYS.scannerAssignments,
            []
          );
          let allMatched = true;

          const updatedAssignments = [...cachedAssignments];

          for (const cached of cachedScanners) {
            const matchByName = result.detectedScanners.find(
              (d: DetectedScanner) => d.name === cached.name
            );
            if (matchByName) {
              for (let i = 0; i < updatedAssignments.length; i++) {
                if (updatedAssignments[i].scannerId === cached.scanner_id) {
                  updatedAssignments[i] = {
                    ...updatedAssignments[i],
                    scannerId: matchByName.scanner_id,
                  };
                }
              }
            } else {
              allMatched = false;
            }
          }

          if (allMatched) {
            setDetectedScanners(result.detectedScanners);
            setScannerAssignments(updatedAssignments);
            setSessionValidated(true);
          } else {
            setValidationWarning(
              result.validationError || 'Some scanners are no longer available'
            );
            setDetectedScanners(result.detectedScanners);
            setIsConfigCollapsed(false);
            setConfigSaved(false);
            setSessionValidated(false);
          }
        } else {
          setIsConfigCollapsed(false);
          setSessionValidated(false);
        }
      } catch {
        setValidationWarning('Scanner validation error. Please reconfigure.');
        setIsConfigCollapsed(false);
        setSessionValidated(false);
      } finally {
        setIsValidating(false);
      }
    }

    validateCachedScanners();
  }, []);

  return {
    platformInfo,
    platformLoading,
    detectedScanners,
    detectingScanner,
    detectionError,
    scannerAssignments,
    config,
    resolution,
    setResolution,
    configSaved,
    isConfigCollapsed,
    sessionValidated,
    isValidating,
    validationWarning,
    configStatus,
    configValidationMessage,
    missingScanners,
    newScanners,
    matchedScanners,
    resolutionRef,
    handleDetectScanners,
    handleResetScannerConfig,
    handleScannerAssignment,
    handleScannerGridMode,
    handleAddScannerSlot,
    handleRemoveScannerSlot,
    handleToggleConfigCollapse,
    clearValidationWarning: () => setValidationWarning(null),
  };
}
