/**
 * Startup integrity audit for GraviScan scanner port identity.
 *
 * `usb_port` is the identity key for a GraviScanner row and the only stable
 * physical identifier the supported hardware affords (the Epson V600 exposes
 * no USB serial number). But the column is nullable, no migration ever
 * backfilled it, and it carries no uniqueness constraint — so a row's identity
 * can be degraded in ways nothing surfaces until a wedge recovery is attempted
 * and fails.
 *
 * This audit reports that state at startup. It is deliberately:
 *
 *  - **read-only** — it never modifies, disables, merges or deletes a row.
 *    Deciding which of two duplicate rows is canonical determines which row
 *    future scans are attributed through, and that belongs to an operator.
 *  - **database-only** — it never invokes USB detection, which keeps it off
 *    the startup critical path. (Comparing a stored port against live
 *    detection also needs a rule for pairing a row with a device when the two
 *    notations differ — and that difference is precisely the finding.)
 *  - **all-rows** — disabled rows included. A row disabled for absence from a
 *    detection set is exactly the state a duplicate leaves behind, and every
 *    other read path filters `enabled: true`, so an enabled-only audit could
 *    not see the population this exists to surface.
 *
 * See openspec/changes/fix-graviscan-scanner-identity-precedence.
 */

import { scanLog } from './scan-logger';
import { isUsablePort } from './scanner-upsert';

/** The subset of the scanner row this audit reads. */
export interface ScannerPortAuditRow {
  id: string;
  name: string;
  display_name: string | null;
  usb_port: string | null;
  enabled: boolean;
}

/** Narrow read-only database surface — no write methods, by construction. */
export interface ScannerPortAuditDb {
  graviScanner: {
    findMany: (args?: { orderBy?: unknown }) => Promise<ScannerPortAuditRow[]>;
  };
}

export type ScannerPortFinding =
  | {
      kind: 'no-port';
      scannerIds: string[];
    }
  | {
      kind: 'duplicate-port';
      usbPort: string;
      scannerIds: string[];
    }
  | {
      kind: 'stranded-disabled';
      usbPort: string;
      scannerIds: string[];
    };

/** Stable, greppable prefix for every line this audit writes. */
const LOG_PREFIX = '[GraviScan:PortAudit]';

/**
 * Audit saved scanner port integrity. Never throws: any failure is logged and
 * reported as an empty result, so a startup path can invoke this
 * fire-and-forget without risking an unhandled rejection at app start.
 */
export async function auditScannerPorts(
  db: ScannerPortAuditDb
): Promise<ScannerPortFinding[]> {
  let rows: ScannerPortAuditRow[];
  try {
    rows = (await db?.graviScanner?.findMany?.()) ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scanLog(`${LOG_PREFIX} audit failed, skipping: ${message}`);
    return [];
  }

  try {
    const findings: ScannerPortFinding[] = [];

    const portless = rows.filter((r) => !isUsablePort(r.usb_port));
    if (portless.length > 0) {
      findings.push({
        kind: 'no-port',
        scannerIds: portless.map((r) => r.id),
      });
    }

    // Duplicates are counted across enabled AND disabled rows: a duplicate's
    // victim is disabled in the same save that creates the duplicate, so an
    // enabled-only tally would miss every real instance.
    const byPort = new Map<string, ScannerPortAuditRow[]>();
    for (const row of rows) {
      if (!isUsablePort(row.usb_port)) continue;
      const bucket = byPort.get(row.usb_port);
      if (bucket) bucket.push(row);
      else byPort.set(row.usb_port, [row]);
    }
    for (const [usbPort, bucket] of byPort) {
      if (bucket.length > 1) {
        findings.push({
          kind: 'duplicate-port',
          usbPort,
          scannerIds: bucket.map((r) => r.id),
        });
      }
    }

    // A disabled row is "stranded" only when another row now holds its port —
    // i.e. it was superseded rather than merely retired.
    //
    // NOT simply "disabled and still holds a port": `disableStaleScannerRows`
    // disables a row while deliberately *preserving* its `usb_port`, so that
    // state is the normal resting condition of any scanner that was ever
    // unplugged or re-cabled. Measured on the production rig
    // (graviscan-ms-7c56, 2026-09-17): 17 rows for 5 scanners, of which 12
    // are disabled and hold a port — all legitimate history from earlier
    // cablings. The broad predicate reported all 12 as findings, which is
    // noise an operator would learn to ignore, and none of them indicated a
    // problem.
    for (const row of rows) {
      if (row.enabled || !isUsablePort(row.usb_port)) continue;
      const supersededBy = rows.filter(
        (other) => other.id !== row.id && other.usb_port === row.usb_port
      );
      if (supersededBy.length === 0) continue;
      findings.push({
        kind: 'stranded-disabled',
        usbPort: row.usb_port,
        scannerIds: [row.id, ...supersededBy.map((o) => o.id)],
      });
    }

    if (findings.length === 0) {
      scanLog(`${LOG_PREFIX} clean — ${rows.length} scanner row(s) checked`);
      return findings;
    }

    for (const finding of findings) {
      if (finding.kind === 'no-port') {
        scanLog(
          `${LOG_PREFIX} no-port scanners=${finding.scannerIds.join(',')} — ` +
            `these cannot be re-identified, so Power-Cycled & Retry will not work for them`
        );
      } else if (finding.kind === 'duplicate-port') {
        scanLog(
          `${LOG_PREFIX} duplicate-port port=${finding.usbPort} ` +
            `scanners=${finding.scannerIds.join(',')} — scanner identity is ambiguous`
        );
      } else {
        scanLog(
          `${LOG_PREFIX} stranded-disabled port=${finding.usbPort} ` +
            `scanners=${finding.scannerIds.join(',')} — disabled row still holding a port`
        );
      }
    }

    return findings;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scanLog(`${LOG_PREFIX} audit failed, skipping: ${message}`);
    return [];
  }
}
