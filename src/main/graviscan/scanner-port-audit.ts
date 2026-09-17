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

/* eslint-disable @typescript-eslint/no-unused-vars */

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

/**
 * Audit saved scanner port integrity. Never throws: any failure is reported to
 * the caller as an empty result after logging, so a startup path can invoke
 * this fire-and-forget without risking an unhandled rejection.
 */
export async function auditScannerPorts(
  _db: ScannerPortAuditDb
): Promise<ScannerPortFinding[]> {
  throw new Error('not implemented');
}
