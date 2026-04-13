/**
 * Persistent file-based logging for GraviScan scan sessions.
 *
 * Writes to ~/.bloom/logs/graviscan-YYYY-MM-DD.log so scan runs are
 * recorded and reviewable even in the packaged app (where stdout is lost).
 *
 * Adapted from Ben's scan-logger.ts (PR #138) with configurable retention.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const LOGS_DIR = path.join(os.homedir(), '.bloom', 'logs');

const DEFAULT_LOG_RETENTION_DAYS = 180;

function parseLogRetentionDays(value: string | undefined): number {
  const parsed = parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_LOG_RETENTION_DAYS;
}

/**
 * Log retention in days. Default 180 for scientific workflows.
 * Configurable via GRAVISCAN_LOG_RETENTION_DAYS environment variable.
 */
export const LOG_RETENTION_DAYS = parseLogRetentionDays(
  process.env.GRAVISCAN_LOG_RETENTION_DAYS
);

let logStream: fs.WriteStream | null = null;
let currentLogDate: string | null = null;

function getLogDate(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getLogPath(date: string): string {
  return path.join(LOGS_DIR, `graviscan-${date}.log`);
}

function ensureStream(): fs.WriteStream {
  const today = getLogDate();
  if (logStream && currentLogDate === today) return logStream;

  // Close previous day's stream
  if (logStream) {
    logStream.end();
  }

  fs.mkdirSync(LOGS_DIR, { recursive: true });
  logStream = fs.createWriteStream(getLogPath(today), { flags: 'a' });
  currentLogDate = today;
  return logStream;
}

/**
 * Write a log entry with ISO timestamp prefix.
 */
export function scanLog(message: string): void {
  const ts = new Date().toISOString();
  const line = `${ts}  ${message}\n`;
  try {
    ensureStream().write(line);
  } catch {
    // Logging should never crash the app
  }
  // Also keep console output for dev mode
  console.log(`[ScanLog] ${message}`);
}

/**
 * Delete log files older than LOG_RETENTION_DAYS.
 * Call once on app startup.
 */
export function cleanupOldLogs(): void {
  try {
    if (!fs.existsSync(LOGS_DIR)) return;
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const file of fs.readdirSync(LOGS_DIR)) {
      if (!file.startsWith('graviscan-') || !file.endsWith('.log')) continue;
      const filePath = path.join(LOGS_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
      }
    }
  } catch {
    // Non-critical — don't crash on cleanup failure
  }
}

/**
 * Close the log stream (call on app quit).
 */
export function closeScanLog(): void {
  if (logStream) {
    logStream.end();
    logStream = null;
    currentLogDate = null;
  }
}
