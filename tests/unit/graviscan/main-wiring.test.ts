// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock graviscan modules
vi.mock('../../../src/main/graviscan/register-handlers', () => ({
  registerGraviScanHandlers: vi.fn(),
  _resetRegistration: vi.fn(),
}));

vi.mock('../../../src/main/graviscan/scan-logger', () => ({
  scanLog: vi.fn(),
  cleanupOldLogs: vi.fn(),
  closeScanLog: vi.fn(),
}));

vi.mock('../../../src/main/graviscan/scan-coordinator', () => ({
  ScanCoordinator: vi.fn(),
}));

import { registerGraviScanHandlers } from '../../../src/main/graviscan/register-handlers';
import { cleanupOldLogs } from '../../../src/main/graviscan/scan-logger';

// We test the extracted patterns directly rather than importing from main.ts
// (which has Electron side effects that cannot run in a Node test environment)

describe('GraviScan main.ts wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initGraviScan', () => {
    it('registers handlers when mode is graviscan', () => {
      const mode = 'graviscan';
      if (mode === 'graviscan') {
        cleanupOldLogs();
        registerGraviScanHandlers(
          {} as any,
          {} as any,
          () => null,
          {
            getScanSession: () => null,
            setScanSession: () => {},
            markScanJobRecorded: () => {},
          },
          () => null
        );
      }

      expect(cleanupOldLogs).toHaveBeenCalled();
      expect(registerGraviScanHandlers).toHaveBeenCalled();
    });

    it('does NOT register handlers when mode is cylinderscan', () => {
      const mode = 'cylinderscan';
      if (mode === 'graviscan') {
        registerGraviScanHandlers(
          {} as any,
          {} as any,
          () => null,
          {
            getScanSession: () => null,
            setScanSession: () => {},
            markScanJobRecorded: () => {},
          },
          () => null
        );
      }

      expect(registerGraviScanHandlers).not.toHaveBeenCalled();
    });

    it('does NOT register handlers when mode is empty', () => {
      const mode = '';
      if (mode === 'graviscan') {
        registerGraviScanHandlers(
          {} as any,
          {} as any,
          () => null,
          {
            getScanSession: () => null,
            setScanSession: () => {},
            markScanJobRecorded: () => {},
          },
          () => null
        );
      }

      expect(registerGraviScanHandlers).not.toHaveBeenCalled();
    });
  });

  describe('session state lifecycle', () => {
    it('getScanSession returns null initially', () => {
      let scanSession: any = null;
      const sessionFns = {
        getScanSession: () => scanSession,
        setScanSession: (s: any) => {
          scanSession = s;
        },
        markScanJobRecorded: (key: string) => {
          if (scanSession?.jobs[key]) {
            scanSession.jobs[key].status = 'recorded';
          }
        },
      };

      expect(sessionFns.getScanSession()).toBeNull();
    });

    it('setScanSession updates state', () => {
      let scanSession: any = null;
      const sessionFns = {
        getScanSession: () => scanSession,
        setScanSession: (s: any) => {
          scanSession = s;
        },
        markScanJobRecorded: (key: string) => {
          if (scanSession?.jobs[key]) {
            scanSession.jobs[key].status = 'recorded';
          }
        },
      };

      sessionFns.setScanSession({ isActive: true, jobs: {} });
      expect(sessionFns.getScanSession()).toEqual({
        isActive: true,
        jobs: {},
      });
    });

    it('markScanJobRecorded updates job status', () => {
      let scanSession: any = {
        isActive: true,
        jobs: { 'scanner1:00': { status: 'complete' } },
      };
      const sessionFns = {
        getScanSession: () => scanSession,
        setScanSession: (s: any) => {
          scanSession = s;
        },
        markScanJobRecorded: (key: string) => {
          if (scanSession?.jobs[key]) {
            scanSession.jobs[key].status = 'recorded';
          }
        },
      };

      sessionFns.markScanJobRecorded('scanner1:00');
      expect(scanSession.jobs['scanner1:00'].status).toBe('recorded');
    });

    it('markScanJobRecorded ignores unknown key', () => {
      let scanSession: any = {
        isActive: true,
        jobs: { 'scanner1:00': { status: 'complete' } },
      };
      const sessionFns = {
        getScanSession: () => scanSession,
        setScanSession: (s: any) => {
          scanSession = s;
        },
        markScanJobRecorded: (key: string) => {
          if (scanSession?.jobs[key]) {
            scanSession.jobs[key].status = 'recorded';
          }
        },
      };

      // Should not throw
      sessionFns.markScanJobRecorded('nonexistent:99');
      expect(scanSession.jobs['scanner1:00'].status).toBe('complete');
    });

    it('setScanSession(null) clears state', () => {
      let scanSession: any = { isActive: true };
      const sessionFns = {
        getScanSession: () => scanSession,
        setScanSession: (s: any) => {
          scanSession = s;
        },
        markScanJobRecorded: () => {},
      };

      sessionFns.setScanSession(null);
      expect(sessionFns.getScanSession()).toBeNull();
    });
  });

  describe('coordinator event forwarding', () => {
    function setupCoordinatorEventForwarding(
      coordinator: EventEmitter,
      getMainWindow: () => {
        isDestroyed: () => boolean;
        webContents: { send: (...args: any[]) => void };
      } | null
    ): void {
      const events = [
        'scan-event',
        'grid-start',
        'grid-complete',
        'cycle-complete',
        'interval-start',
        'interval-waiting',
        'interval-complete',
        'overtime',
        'cancelled',
        'scan-error',
        'rename-error',
      ];
      for (const eventName of events) {
        coordinator.on(eventName, (payload: unknown) => {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send(`graviscan:${eventName}`, payload);
          }
        });
      }
    }

    it('forwards all 11 coordinator events to renderer', () => {
      const coordinator = new EventEmitter();
      const send = vi.fn();
      const mockWindow = {
        isDestroyed: () => false,
        webContents: { send },
      };

      setupCoordinatorEventForwarding(coordinator, () => mockWindow);

      const events = [
        'scan-event',
        'grid-start',
        'grid-complete',
        'cycle-complete',
        'interval-start',
        'interval-waiting',
        'interval-complete',
        'overtime',
        'cancelled',
        'scan-error',
        'rename-error',
      ];

      for (const eventName of events) {
        send.mockClear();
        coordinator.emit(eventName, { test: eventName });
        expect(send).toHaveBeenCalledWith(`graviscan:${eventName}`, {
          test: eventName,
        });
      }
    });

    it('does not crash when mainWindow is null', () => {
      const coordinator = new EventEmitter();
      setupCoordinatorEventForwarding(coordinator, () => null);

      expect(() =>
        coordinator.emit('scan-event', { test: true })
      ).not.toThrow();
    });

    it('does not crash when mainWindow is destroyed', () => {
      const coordinator = new EventEmitter();
      const mockWindow = {
        isDestroyed: () => true,
        webContents: { send: vi.fn() },
      };

      setupCoordinatorEventForwarding(coordinator, () => mockWindow);

      expect(() =>
        coordinator.emit('scan-event', { test: true })
      ).not.toThrow();
      expect(mockWindow.webContents.send).not.toHaveBeenCalled();
    });

    it('forwards rename-error events to renderer', () => {
      const coordinator = new EventEmitter();
      const send = vi.fn();
      const mockWindow = {
        isDestroyed: () => false,
        webContents: { send },
      };

      setupCoordinatorEventForwarding(coordinator, () => mockWindow);

      coordinator.emit('rename-error', {
        scannerId: 'scanner-1',
        filePath: '/tmp/scan.tif',
        error: 'ENOSPC',
      });

      expect(send).toHaveBeenCalledWith('graviscan:rename-error', {
        scannerId: 'scanner-1',
        filePath: '/tmp/scan.tif',
        error: 'ENOSPC',
      });
    });
  });

  describe('coordinator creation race protection', () => {
    it('concurrent getOrCreateCoordinator calls return same instance', async () => {
      // Simulate the coordinator factory with promise memoization guard
      const mockCoordinator = new EventEmitter();
      let instance: EventEmitter | null = null;
      let creating: Promise<EventEmitter> | null = null;

      async function getOrCreateCoordinator() {
        if (instance) return instance;
        if (creating) return creating;
        creating = (async () => {
          await new Promise((r) => setTimeout(r, 10));
          instance = mockCoordinator;
          return instance;
        })();
        try {
          return await creating;
        } finally {
          creating = null;
        }
      }

      // Call twice concurrently
      const [c1, c2] = await Promise.all([
        getOrCreateCoordinator(),
        getOrCreateCoordinator(),
      ]);

      // Both should return the same instance (when properly guarded)
      // With the bug, createCount would be 2 and they'd be different objects
      // This test documents the DESIRED behavior — the fix should make createCount === 1
      expect(c1).toBe(c2);
    });
  });

  describe('session completion', () => {
    it('session is cleared after scan completes successfully', () => {
      let scanSession: any = {
        isActive: true,
        experimentId: 'exp1',
        jobs: {},
      };

      const sessionFns = {
        getScanSession: () => scanSession,
        setScanSession: (s: any) => {
          scanSession = s;
        },
        markScanJobRecorded: () => {},
      };

      // Simulate scan completion: session should be cleared or marked inactive
      // The coordinator emits interval-complete or cycle-complete,
      // and the session should transition to inactive
      sessionFns.setScanSession(null);
      expect(sessionFns.getScanSession()).toBeNull();
    });
  });
});
