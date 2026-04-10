// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('fs');
vi.mock('os', async (importOriginal) => {
  const original = await importOriginal<typeof import('os')>();
  return {
    ...original,
    homedir: vi.fn().mockReturnValue('/mock-home'),
  };
});

const LOGS_DIR = path.join('/mock-home', '.bloom', 'logs');

describe('scan-logger', () => {
  let mockStream: {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    // Re-mock after resetModules
    vi.mocked(os.homedir).mockReturnValue('/mock-home');

    mockStream = {
      write: vi.fn(),
      end: vi.fn(),
    };
    vi.mocked(fs.createWriteStream).mockReturnValue(
      mockStream as unknown as fs.WriteStream
    );
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    // Suppress console.log from scanLog
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('scanLog()', () => {
    it('writes timestamped entry to daily log file', async () => {
      const { scanLog } = await import(
        '../../../src/main/graviscan/scan-logger'
      );

      scanLog('Scanner S1 started');

      expect(fs.mkdirSync).toHaveBeenCalledWith(LOGS_DIR, {
        recursive: true,
      });
      expect(fs.createWriteStream).toHaveBeenCalledWith(
        expect.stringContaining('graviscan-'),
        { flags: 'a' }
      );
      expect(mockStream.write).toHaveBeenCalledWith(
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.+Scanner S1 started\n$/)
      );
    });

    it('creates log directory if it does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const { scanLog } = await import(
        '../../../src/main/graviscan/scan-logger'
      );

      scanLog('test message');

      expect(fs.mkdirSync).toHaveBeenCalledWith(LOGS_DIR, {
        recursive: true,
      });
    });

    it('reuses stream for same day', async () => {
      const { scanLog } = await import(
        '../../../src/main/graviscan/scan-logger'
      );

      scanLog('message 1');
      scanLog('message 2');

      // createWriteStream should only be called once for same day
      expect(fs.createWriteStream).toHaveBeenCalledTimes(1);
      expect(mockStream.write).toHaveBeenCalledTimes(2);
    });

    it('does not crash if write throws', async () => {
      mockStream.write.mockImplementation(() => {
        throw new Error('disk full');
      });
      const { scanLog } = await import(
        '../../../src/main/graviscan/scan-logger'
      );

      // Should not throw
      expect(() => scanLog('test')).not.toThrow();
    });
  });

  describe('cleanupOldLogs()', () => {
    it('deletes files older than LOG_RETENTION_DAYS', async () => {
      const now = Date.now();
      const oldDate = now - 200 * 24 * 60 * 60 * 1000; // 200 days ago
      vi.mocked(fs.readdirSync).mockReturnValue([
        'graviscan-2025-01-01.log' as unknown as string,
      ]);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: oldDate,
      } as fs.Stats);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

      const { cleanupOldLogs } = await import(
        '../../../src/main/graviscan/scan-logger'
      );
      cleanupOldLogs();

      expect(fs.unlinkSync).toHaveBeenCalledWith(
        path.join(LOGS_DIR, 'graviscan-2025-01-01.log')
      );
    });

    it('preserves recent log files', async () => {
      const now = Date.now();
      const recentDate = now - 10 * 24 * 60 * 60 * 1000; // 10 days ago
      vi.mocked(fs.readdirSync).mockReturnValue([
        'graviscan-2026-04-01.log' as unknown as string,
      ]);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: recentDate,
      } as fs.Stats);

      const { cleanupOldLogs } = await import(
        '../../../src/main/graviscan/scan-logger'
      );
      cleanupOldLogs();

      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it('skips non-graviscan files', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue([
        'other-file.log' as unknown as string,
        'graviscan-2025-01-01.log' as unknown as string,
      ]);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: 0,
      } as fs.Stats);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

      const { cleanupOldLogs } = await import(
        '../../../src/main/graviscan/scan-logger'
      );
      cleanupOldLogs();

      // Should only try to unlink the graviscan file
      expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
      expect(fs.unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('graviscan-2025-01-01.log')
      );
    });

    it('does nothing if logs directory does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { cleanupOldLogs } = await import(
        '../../../src/main/graviscan/scan-logger'
      );
      cleanupOldLogs();

      expect(fs.readdirSync).not.toHaveBeenCalled();
    });

    it('does not crash on error', async () => {
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error('permission denied');
      });

      const { cleanupOldLogs } = await import(
        '../../../src/main/graviscan/scan-logger'
      );

      expect(() => cleanupOldLogs()).not.toThrow();
    });
  });

  describe('closeScanLog()', () => {
    it('flushes and closes the stream', async () => {
      const { scanLog, closeScanLog } = await import(
        '../../../src/main/graviscan/scan-logger'
      );

      // Open a stream first
      scanLog('open stream');
      expect(mockStream.write).toHaveBeenCalled();

      closeScanLog();
      expect(mockStream.end).toHaveBeenCalled();
    });

    it('subsequent scanLog after close opens a new stream', async () => {
      const newStream = {
        write: vi.fn(),
        end: vi.fn(),
      };
      const { scanLog, closeScanLog } = await import(
        '../../../src/main/graviscan/scan-logger'
      );

      // Open and close
      scanLog('first');
      closeScanLog();

      // Now mock a new stream for the next call
      vi.mocked(fs.createWriteStream).mockReturnValue(
        newStream as unknown as fs.WriteStream
      );

      scanLog('second');

      // createWriteStream should have been called again
      expect(fs.createWriteStream).toHaveBeenCalledTimes(2);
      expect(newStream.write).toHaveBeenCalledWith(
        expect.stringContaining('second')
      );
    });

    it('is safe to call when no stream is open', async () => {
      const { closeScanLog } = await import(
        '../../../src/main/graviscan/scan-logger'
      );

      // Should not throw
      expect(() => closeScanLog()).not.toThrow();
    });
  });
});
