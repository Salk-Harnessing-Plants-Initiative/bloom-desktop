import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useContinuousMode } from '../../../src/renderer/hooks/useContinuousMode';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
  });
});

describe('useContinuousMode', () => {
  it('should initialize with default single mode', () => {
    const { result } = renderHook(() =>
      useContinuousMode({ isScanning: false })
    );
    expect(result.current.scanMode).toBe('single');
    expect(result.current.currentCycle).toBe(0);
    expect(result.current.intervalCountdown).toBeNull();
    expect(result.current.overtimeMs).toBeNull();
  });

  it('should switch to continuous mode', () => {
    const { result } = renderHook(() =>
      useContinuousMode({ isScanning: false })
    );
    act(() => result.current.setScanMode('continuous'));
    expect(result.current.scanMode).toBe('continuous');
  });

  it('should update interval and duration', () => {
    const { result } = renderHook(() =>
      useContinuousMode({ isScanning: false })
    );
    act(() => {
      result.current.setScanIntervalMinutes(5);
      result.current.setScanDurationMinutes(60);
    });
    expect(result.current.scanIntervalMinutes).toBe(5);
    expect(result.current.scanDurationMinutes).toBe(60);
  });

  it('should track cycles', () => {
    const { result } = renderHook(() =>
      useContinuousMode({ isScanning: false })
    );
    act(() => {
      result.current.setCurrentCycle(3);
      result.current.setTotalCycles(10);
    });
    expect(result.current.currentCycle).toBe(3);
    expect(result.current.totalCycles).toBe(10);
  });

  it('should provide refs for event handlers', () => {
    const { result } = renderHook(() =>
      useContinuousMode({ isScanning: false })
    );
    expect(result.current.scanModeRef).toBeDefined();
    expect(result.current.cycleCompletedCountRef).toBeDefined();
    expect(result.current.intervalCountdownRef).toBeDefined();
  });
});
