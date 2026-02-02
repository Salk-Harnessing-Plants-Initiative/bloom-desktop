# Spec Delta: Scanning - Event Listener Memory Leak Fix

This spec delta fixes event listener memory leaks in the scanning workflow.

## MODIFIED Requirements

### Requirement: Scanner Event Listener Lifecycle

Scanner event listeners SHALL be properly cleaned up when component unmounts or dependencies change to prevent memory leaks and duplicate event handling.

#### Scenario: Event listeners return cleanup functions

- **GIVEN** the scanner API is available
- **WHEN** a component registers event listeners using `onProgress`, `onComplete`, or `onError`
- **THEN** each listener registration SHALL return a cleanup function
- **AND** calling the cleanup function SHALL remove the specific listener
- **AND** the cleanup function SHALL follow the same pattern as `camera.onFrame`

#### Scenario: Component cleanup on unmount

- **GIVEN** a component has registered scanner event listeners
- **WHEN** the component unmounts
- **THEN** all registered listeners SHALL be automatically removed
- **AND** no event handlers SHALL fire after unmount
- **AND** no memory leaks SHALL occur

#### Scenario: Component cleanup on dependency change

- **GIVEN** a useEffect has registered scanner event listeners
- **AND** the useEffect has dependencies
- **WHEN** any dependency value changes
- **THEN** all listeners from the previous effect SHALL be removed
- **AND** new listeners SHALL be registered with current dependency values
- **AND** only ONE set of listeners SHALL be active at any time

#### Scenario: Single scan completion event

- **GIVEN** a user starts a scan
- **AND** the user has typed in the Plant QR Code field multiple times
- **WHEN** the scan completes successfully
- **THEN** exactly ONE `onComplete` event SHALL fire
- **AND** exactly ONE scan entry SHALL be added to the recent scans list
- **AND** the scan SHALL appear exactly once in the UI

### Requirement: Interval Cleanup

useEffect hooks that create intervals or timers SHALL clean them up when dependencies change or component unmounts.

#### Scenario: Polling interval cleanup

- **GIVEN** a useEffect creates an interval for polling
- **WHEN** the component unmounts
- **THEN** the interval SHALL be cleared
- **AND** no polling SHALL continue after unmount

#### Scenario: Polling interval cleanup on dependency change

- **GIVEN** a useEffect with an interval and dependencies
- **WHEN** any dependency changes
- **THEN** the previous interval SHALL be cleared
- **AND** a new interval SHALL be created with current dependency values
- **AND** only ONE interval SHALL be active at any time

## Technical Notes

### Event Listener Pattern (Following camera.onFrame)

```typescript
// preload.ts - Scanner API
const scannerAPI: ScannerAPI = {
  // ... other methods ...

  onProgress: (callback: (progress: ScanProgress) => void) => {
    const listener = (_event: unknown, progress: ScanProgress) =>
      callback(progress);
    ipcRenderer.on('scanner:progress', listener);
    // Return cleanup function to remove listener
    return () => ipcRenderer.removeListener('scanner:progress', listener);
  },

  onComplete: (callback: (result: ScanResult) => void) => {
    const listener = (_event: unknown, result: ScanResult) => callback(result);
    ipcRenderer.on('scanner:complete', listener);
    return () => ipcRenderer.removeListener('scanner:complete', listener);
  },

  onError: (callback: (error: string) => void) => {
    const listener = (_event: unknown, error: string) => callback(error);
    ipcRenderer.on('scanner:error', listener);
    return () => ipcRenderer.removeListener('scanner:error', listener);
  },
};
```

### Type System Updates

```typescript
// src/types/scanner.ts
export interface ScannerAPI {
  // ... other methods ...

  /**
   * Event listener for scan progress updates.
   *
   * @param callback - Function called with progress updates
   * @returns Cleanup function to remove the listener
   */
  onProgress: (callback: (progress: ScanProgress) => void) => () => void;

  /**
   * Event listener for scan completion.
   *
   * @param callback - Function called when scan completes
   * @returns Cleanup function to remove the listener
   */
  onComplete: (callback: (result: ScanResult) => void) => () => void;

  /**
   * Event listener for scanner errors.
   *
   * @param callback - Function called on errors
   * @returns Cleanup function to remove the listener
   */
  onError: (callback: (error: string) => void) => () => void;
}
```

### Component Usage Pattern

```typescript
// src/renderer/CaptureScan.tsx

// Scanner progress event listener
useEffect(() => {
  if (!isScanning) return;

  const handleProgress = (progress: ScanProgressData) => {
    setScanProgress(progress);
  };

  const handleComplete = (result: ScanResult) => {
    setIsScanning(false);
    setScanProgress(null);

    if (result.success) {
      const newScan: ScanSummary = {
        id: `scan-${Date.now()}`,
        plantQrCode: metadata.plantQrCode,
        timestamp: new Date(),
        framesCaptured: result.frames_captured,
        success: true,
        outputPath: result.output_path,
      };
      setRecentScans((prev) => [newScan, ...prev].slice(0, 10));
      setShowSuccessMessage(true);
      setTimeout(() => setShowSuccessMessage(false), 5000);
    } else {
      setErrorMessage(result.error || 'Scan failed');
      setTimeout(() => setErrorMessage(null), 5000);
    }
  };

  const handleError = (error: string) => {
    setIsScanning(false);
    setScanProgress(null);
    setErrorMessage(error);
    setTimeout(() => setErrorMessage(null), 5000);
  };

  // Register listeners and get cleanup functions
  const cleanupProgress = window.electron.scanner.onProgress(handleProgress);
  const cleanupComplete = window.electron.scanner.onComplete(handleComplete);
  const cleanupError = window.electron.scanner.onError(handleError);

  // Cleanup function removes all listeners
  return () => {
    cleanupProgress();
    cleanupComplete();
    cleanupError();
  };
}, [isScanning]); // Removed metadata.plantQrCode from dependencies

// Duplicate scan check with interval cleanup
useEffect(() => {
  const checkDuplicateScan = async () => {
    if (!metadata.plantQrCode.trim() || !metadata.experimentId.trim()) {
      setDuplicateScanWarning(null);
      return;
    }

    try {
      const result = await window.electron.database.scans.getMostRecentScanDate(
        metadata.plantQrCode,
        metadata.experimentId
      );

      if (result.success && result.data) {
        const scanDate = new Date(result.data);
        const today = new Date();

        const isSameDay =
          scanDate.getFullYear() === today.getFullYear() &&
          scanDate.getMonth() === today.getMonth() &&
          scanDate.getDate() === today.getDate();

        if (isSameDay) {
          setDuplicateScanWarning('This plant was already scanned today');
        } else {
          setDuplicateScanWarning(null);
        }
      } else {
        setDuplicateScanWarning(null);
      }
    } catch (error) {
      console.error('Failed to check for duplicate scan:', error);
      setDuplicateScanWarning(null);
    }
  };

  checkDuplicateScan();
  const intervalId = setInterval(checkDuplicateScan, 2000);

  // Cleanup interval on unmount or dependency change
  return () => {
    clearInterval(intervalId);
  };
}, [metadata.plantQrCode, metadata.experimentId]);
```

### Why Remove metadata.plantQrCode from Scanner useEffect Dependencies?

The `metadata.plantQrCode` value is only used inside the `handleComplete` callback to create the scan summary. When the scan starts, the current value of `metadata.plantQrCode` is captured in the closure and will be used when the scan completes, even if the user types a new barcode while scanning.

**This is the correct behavior** - we want the scan entry to show the barcode that was scanned, not whatever the user typed after starting the scan.

By removing it from dependencies:

1. Event listeners only register when `isScanning` changes (scan starts/stops)
2. No listener accumulation from typing in the barcode field
3. Fixes the duplicate scans bug
4. Still captures the correct barcode value for each scan
