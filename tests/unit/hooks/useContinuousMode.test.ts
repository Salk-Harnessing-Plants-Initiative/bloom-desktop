import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useContinuousMode } from '../../../src/renderer/hooks/useContinuousMode';

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useContinuousMode', () => {
  describe('initialization defaults', () => {
    it('defaults scanMode to "single"', () => {
      const { result } = renderHook(() => useContinuousMode(false));
      expect(result.current.scanMode).toBe('single');
    });

    it('defaults scanIntervalMinutes to 5', () => {
      const { result } = renderHook(() => useContinuousMode(false));
      expect(result.current.scanIntervalMinutes).toBe(5);
    });

    it('defaults scanDurationMinutes to 60', () => {
      const { result } = renderHook(() => useContinuousMode(false));
      expect(result.current.scanDurationMinutes).toBe(60);
    });

    it('defaults currentCycle to 0', () => {
      const { result } = renderHook(() => useContinuousMode(false));
      expect(result.current.currentCycle).toBe(0);
    });

    it('defaults totalCycles to 0', () => {
      const { result } = renderHook(() => useContinuousMode(false));
      expect(result.current.totalCycles).toBe(0);
    });

    it('defaults intervalCountdown to null', () => {
      const { result } = renderHook(() => useContinuousMode(false));
      expect(result.current.intervalCountdown).toBeNull();
    });

    it('defaults overtimeMs to null', () => {
      const { result } = renderHook(() => useContinuousMode(false));
      expect(result.current.overtimeMs).toBeNull();
    });

    it('defaults elapsedSeconds to 0', () => {
      const { result } = renderHook(() => useContinuousMode(false));
      expect(result.current.elapsedSeconds).toBe(0);
    });
  });

  describe('mode switching', () => {
    it('switches from single to continuous', () => {
      const { result } = renderHook(() => useContinuousMode(false));

      act(() => {
        result.current.setScanMode('continuous');
      });

      expect(result.current.scanMode).toBe('continuous');
    });

    it('switches from continuous back to single', () => {
      const { result } = renderHook(() => useContinuousMode(false));

      act(() => {
        result.current.setScanMode('continuous');
      });
      act(() => {
        result.current.setScanMode('single');
      });

      expect(result.current.scanMode).toBe('single');
    });

    it('keeps scanModeRef in sync with state', () => {
      const { result } = renderHook(() => useContinuousMode(false));

      act(() => {
        result.current.setScanMode('continuous');
      });

      expect(result.current.scanModeRef.current).toBe('continuous');
    });
  });

  describe('interval and duration setting', () => {
    it('updates scanIntervalMinutes', () => {
      const { result } = renderHook(() => useContinuousMode(false));

      act(() => {
        result.current.setScanIntervalMinutes(10);
      });

      expect(result.current.scanIntervalMinutes).toBe(10);
    });

    it('updates scanDurationMinutes', () => {
      const { result } = renderHook(() => useContinuousMode(false));

      act(() => {
        result.current.setScanDurationMinutes(120);
      });

      expect(result.current.scanDurationMinutes).toBe(120);
    });
  });

  describe('cycle tracking', () => {
    it('updates currentCycle', () => {
      const { result } = renderHook(() => useContinuousMode(false));

      act(() => {
        result.current.setCurrentCycle(3);
      });

      expect(result.current.currentCycle).toBe(3);
    });

    it('updates totalCycles', () => {
      const { result } = renderHook(() => useContinuousMode(false));

      act(() => {
        result.current.setTotalCycles(12);
      });

      expect(result.current.totalCycles).toBe(12);
    });

    it('resetCycleProgress clears cycleCompletedCountRef', () => {
      const { result } = renderHook(() => useContinuousMode(false));

      // Simulate some cycle completions
      result.current.cycleCompletedCountRef.current = {
        scanner1: 3,
        scanner2: 2,
      };

      act(() => {
        result.current.resetCycleProgress();
      });

      expect(result.current.cycleCompletedCountRef.current).toEqual({});
    });
  });

  describe('timer functions', () => {
    it('startElapsedTimer sets elapsedSeconds and ticks', () => {
      const { result } = renderHook(() => useContinuousMode(true));

      act(() => {
        result.current.startElapsedTimer();
      });

      expect(result.current.elapsedSeconds).toBe(0);

      // Advance 3 seconds
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.elapsedSeconds).toBe(3);
    });

    it('startCountdown decrements from initial value', () => {
      const { result } = renderHook(() => useContinuousMode(false));

      act(() => {
        result.current.startCountdown(10);
      });

      expect(result.current.intervalCountdown).toBe(10);

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.intervalCountdown).toBe(7);
    });

    it('startCountdown stops at 0', () => {
      const { result } = renderHook(() => useContinuousMode(false));

      act(() => {
        result.current.startCountdown(2);
      });

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.intervalCountdown).toBe(0);
    });

    it('startOvertime tracks overtime milliseconds', () => {
      const { result } = renderHook(() => useContinuousMode(false));

      act(() => {
        result.current.startOvertime(500);
      });

      expect(result.current.overtimeMs).toBe(500);

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(result.current.overtimeMs).toBeGreaterThanOrEqual(2000);
    });

    it('startOvertime is a no-op if already in overtime', () => {
      const { result } = renderHook(() => useContinuousMode(false));

      act(() => {
        result.current.startOvertime(100);
      });

      const firstOvertimeMs = result.current.overtimeMs;

      // Try to start again — should be ignored
      act(() => {
        result.current.startOvertime(9999);
      });

      // Value should not have been reset to 9999
      expect(result.current.overtimeMs).toBe(firstOvertimeMs);
    });
  });

  describe('timer cleanup on unmount', () => {
    it('clearAllTimers clears all running timers', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const { result } = renderHook(() => useContinuousMode(true));

      act(() => {
        result.current.startElapsedTimer();
        result.current.startCountdown(30);
        result.current.startOvertime(0);
      });

      act(() => {
        result.current.clearAllTimers();
      });

      // Verify clearInterval was called for the timers
      expect(clearIntervalSpy).toHaveBeenCalled();

      // Values should be reset
      expect(result.current.intervalCountdown).toBeNull();
      expect(result.current.overtimeMs).toBeNull();
      expect(result.current.elapsedTimerRef.current).toBeNull();

      clearIntervalSpy.mockRestore();
    });

    it('clearCountdownAndOvertime clears countdown and overtime but not elapsed', () => {
      const { result } = renderHook(() => useContinuousMode(true));

      act(() => {
        result.current.startElapsedTimer();
        result.current.startCountdown(30);
        result.current.startOvertime(0);
      });

      act(() => {
        result.current.clearCountdownAndOvertime();
      });

      expect(result.current.intervalCountdown).toBeNull();
      expect(result.current.overtimeMs).toBeNull();
      expect(result.current.intervalCountdownRef.current).toBeNull();
      expect(result.current.overtimeTimerRef.current).toBeNull();
      // elapsed timer should still be running
      expect(result.current.elapsedTimerRef.current).not.toBeNull();
    });

    it('stops elapsed timer when isScanning becomes false', () => {
      const { result, rerender } = renderHook(
        ({ scanning }) => useContinuousMode(scanning),
        { initialProps: { scanning: true } }
      );

      act(() => {
        result.current.startElapsedTimer();
      });

      expect(result.current.elapsedTimerRef.current).not.toBeNull();

      // Simulate scanning stopping
      rerender({ scanning: false });

      expect(result.current.elapsedTimerRef.current).toBeNull();
    });
  });

  describe('localStorage persistence', () => {
    it('persists scanMode to localStorage', () => {
      const { result } = renderHook(() => useContinuousMode(false));

      act(() => {
        result.current.setScanMode('continuous');
      });

      expect(localStorage.getItem('graviscan:scanMode')).toBe('"continuous"');
    });

    it('persists scanIntervalMinutes to localStorage', () => {
      const { result } = renderHook(() => useContinuousMode(false));

      act(() => {
        result.current.setScanIntervalMinutes(15);
      });

      expect(localStorage.getItem('graviscan:scanInterval')).toBe('15');
    });

    it('persists scanDurationMinutes to localStorage', () => {
      const { result } = renderHook(() => useContinuousMode(false));

      act(() => {
        result.current.setScanDurationMinutes(90);
      });

      expect(localStorage.getItem('graviscan:scanDuration')).toBe('90');
    });

    it('restores scanMode from localStorage on mount', () => {
      localStorage.setItem('graviscan:scanMode', '"continuous"');

      const { result } = renderHook(() => useContinuousMode(false));

      expect(result.current.scanMode).toBe('continuous');
    });

    it('restores scanIntervalMinutes from localStorage on mount', () => {
      localStorage.setItem('graviscan:scanInterval', '20');

      const { result } = renderHook(() => useContinuousMode(false));

      expect(result.current.scanIntervalMinutes).toBe(20);
    });

    it('restores scanDurationMinutes from localStorage on mount', () => {
      localStorage.setItem('graviscan:scanDuration', '180');

      const { result } = renderHook(() => useContinuousMode(false));

      expect(result.current.scanDurationMinutes).toBe(180);
    });

    it('falls back to defaults on invalid localStorage data', () => {
      localStorage.setItem('graviscan:scanMode', '{invalid json');

      const { result } = renderHook(() => useContinuousMode(false));

      expect(result.current.scanMode).toBe('single');
    });
  });
});
