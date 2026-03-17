import { useState, useEffect, useRef, useCallback } from 'react';

// LocalStorage keys
const STORAGE_KEYS = {
  scanMode: 'graviscan:scanMode',
  scanInterval: 'graviscan:scanInterval',
  scanDuration: 'graviscan:scanDuration',
};

function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return defaultValue;
}

function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore */ }
}

type ScanMode = 'single' | 'continuous';

export interface UseContinuousModeReturn {
  // State
  scanMode: ScanMode;
  setScanMode: React.Dispatch<React.SetStateAction<ScanMode>>;
  scanIntervalMinutes: number;
  setScanIntervalMinutes: React.Dispatch<React.SetStateAction<number>>;
  scanDurationMinutes: number;
  setScanDurationMinutes: React.Dispatch<React.SetStateAction<number>>;
  currentCycle: number;
  setCurrentCycle: React.Dispatch<React.SetStateAction<number>>;
  totalCycles: number;
  setTotalCycles: React.Dispatch<React.SetStateAction<number>>;
  intervalCountdown: number | null;
  setIntervalCountdown: React.Dispatch<React.SetStateAction<number | null>>;
  overtimeMs: number | null;
  setOvertimeMs: React.Dispatch<React.SetStateAction<number | null>>;
  elapsedSeconds: number;
  setElapsedSeconds: React.Dispatch<React.SetStateAction<number>>;

  // Refs (needed by event handlers that access via ref to avoid stale closures)
  scanModeRef: React.MutableRefObject<ScanMode>;
  cycleCompletedCountRef: React.MutableRefObject<Record<string, number>>;
  intervalCountdownRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>;
  overtimeTimerRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>;
  overtimeStartRef: React.MutableRefObject<number | null>;
  scanStartedAtMsRef: React.MutableRefObject<number | null>;
  elapsedTimerRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>;

  // Timer control functions
  startElapsedTimer: (startTimeMs?: number) => void;
  startCountdown: (seconds: number) => void;
  startOvertime: (initialMs: number) => void;
  clearCountdownAndOvertime: () => void;
  clearAllTimers: () => void;
  resetCycleProgress: () => void;
}

export function useContinuousMode(isScanning: boolean): UseContinuousModeReturn {
  // State
  const [scanMode, setScanMode] = useState<ScanMode>(() =>
    loadFromStorage(STORAGE_KEYS.scanMode, 'single') as ScanMode
  );
  const [scanIntervalMinutes, setScanIntervalMinutes] = useState<number>(() =>
    loadFromStorage(STORAGE_KEYS.scanInterval, 5)
  );
  const [scanDurationMinutes, setScanDurationMinutes] = useState<number>(() =>
    loadFromStorage(STORAGE_KEYS.scanDuration, 60)
  );
  const [currentCycle, setCurrentCycle] = useState(0);
  const [totalCycles, setTotalCycles] = useState(0);
  const [intervalCountdown, setIntervalCountdown] = useState<number | null>(null);
  const [overtimeMs, setOvertimeMs] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Refs
  const scanModeRef = useRef(scanMode);
  const cycleCompletedCountRef = useRef<Record<string, number>>({});
  const intervalCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const overtimeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const overtimeStartRef = useRef<number | null>(null);
  const scanStartedAtMsRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep scanModeRef in sync
  useEffect(() => { scanModeRef.current = scanMode; }, [scanMode]);

  // Persist to localStorage
  useEffect(() => { saveToStorage(STORAGE_KEYS.scanMode, scanMode); }, [scanMode]);
  useEffect(() => { saveToStorage(STORAGE_KEYS.scanInterval, scanIntervalMinutes); }, [scanIntervalMinutes]);
  useEffect(() => { saveToStorage(STORAGE_KEYS.scanDuration, scanDurationMinutes); }, [scanDurationMinutes]);

  // Stop elapsed timer when scanning ends
  useEffect(() => {
    if (!isScanning && elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, [isScanning]);

  // Timer control functions
  const startElapsedTimer = useCallback((startTimeMs?: number) => {
    scanStartedAtMsRef.current = startTimeMs ?? Date.now();
    setElapsedSeconds(Math.floor((Date.now() - scanStartedAtMsRef.current) / 1000));
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => {
      if (scanStartedAtMsRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - scanStartedAtMsRef.current) / 1000));
      }
    }, 1000);
  }, []);

  const startCountdown = useCallback((seconds: number) => {
    setIntervalCountdown(seconds);
    if (intervalCountdownRef.current) clearInterval(intervalCountdownRef.current);
    intervalCountdownRef.current = setInterval(() => {
      setIntervalCountdown((prev) => {
        if (prev === null || prev <= 1) {
          if (intervalCountdownRef.current) clearInterval(intervalCountdownRef.current);
          intervalCountdownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const startOvertime = useCallback((initialMs: number) => {
    if (overtimeStartRef.current !== null) return; // already in overtime
    overtimeStartRef.current = Date.now() - initialMs;
    setOvertimeMs(initialMs);
    if (overtimeTimerRef.current) clearInterval(overtimeTimerRef.current);
    overtimeTimerRef.current = setInterval(() => {
      if (overtimeStartRef.current !== null) {
        setOvertimeMs(Date.now() - overtimeStartRef.current);
      }
    }, 1000);
  }, []);

  const clearCountdownAndOvertime = useCallback(() => {
    setIntervalCountdown(null);
    if (intervalCountdownRef.current) clearInterval(intervalCountdownRef.current);
    intervalCountdownRef.current = null;
    setOvertimeMs(null);
    overtimeStartRef.current = null;
    if (overtimeTimerRef.current) clearInterval(overtimeTimerRef.current);
    overtimeTimerRef.current = null;
  }, []);

  const clearAllTimers = useCallback(() => {
    clearCountdownAndOvertime();
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = null;
    scanStartedAtMsRef.current = null;
  }, [clearCountdownAndOvertime]);

  const resetCycleProgress = useCallback(() => {
    cycleCompletedCountRef.current = {};
  }, []);

  return {
    scanMode, setScanMode,
    scanIntervalMinutes, setScanIntervalMinutes,
    scanDurationMinutes, setScanDurationMinutes,
    currentCycle, setCurrentCycle,
    totalCycles, setTotalCycles,
    intervalCountdown, setIntervalCountdown,
    overtimeMs, setOvertimeMs,
    elapsedSeconds, setElapsedSeconds,
    scanModeRef, cycleCompletedCountRef,
    intervalCountdownRef, overtimeTimerRef, overtimeStartRef,
    scanStartedAtMsRef, elapsedTimerRef,
    startElapsedTimer, startCountdown, startOvertime,
    clearCountdownAndOvertime, clearAllTimers, resetCycleProgress,
  };
}
