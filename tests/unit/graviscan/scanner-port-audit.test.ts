// @vitest-environment node
/**
 * Startup scanner-port integrity audit.
 *
 * The audit is the only mitigation shipping with a BREAKING, un-migrated
 * identity change, so the properties under test here are load-bearing:
 * it must see disabled rows, must never write, must never invoke USB
 * detection, and must never throw — a startup path invokes it
 * fire-and-forget, so an escaping rejection would surface as an unhandled
 * rejection at app start.
 *
 * See openspec/changes/fix-graviscan-scanner-identity-precedence.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi } from 'vitest';
import {
  auditScannerPorts,
  type ScannerPortAuditRow,
} from '../../../src/main/graviscan/scanner-port-audit';

function makeRow(
  overrides: Partial<ScannerPortAuditRow> = {}
): ScannerPortAuditRow {
  return {
    id: 'sc-1',
    name: 'Perfection V600 Photo',
    display_name: null,
    usb_port: '1-8',
    enabled: true,
    ...overrides,
  };
}

function makeDb(rows: ScannerPortAuditRow[]) {
  const findMany = vi.fn(async () => rows.map((r) => ({ ...r })));
  return {
    db: { graviScanner: { findMany } } as any,
    findMany,
  };
}

describe('auditScannerPorts', () => {
  it('reports a row whose usb_port is null', async () => {
    const { db } = makeDb([makeRow({ id: 'sc-1', usb_port: null })]);

    const findings = await auditScannerPorts(db);

    expect(findings).toContainEqual(
      expect.objectContaining({ kind: 'no-port', scannerIds: ['sc-1'] })
    );
  });

  it('reports a row whose usb_port is the empty string', async () => {
    const { db } = makeDb([makeRow({ id: 'sc-1', usb_port: '' })]);

    const findings = await auditScannerPorts(db);

    expect(findings).toContainEqual(
      expect.objectContaining({ kind: 'no-port', scannerIds: ['sc-1'] })
    );
  });

  it('reports a duplicate port held by an enabled and a disabled row', async () => {
    // The duplicate's victim is disabled in the same saveScannersToDB call
    // that creates the duplicate, so an enabled-only audit would miss exactly
    // the population it exists to surface.
    const { db } = makeDb([
      makeRow({ id: 'sc-enabled', usb_port: '1-2.3', enabled: true }),
      makeRow({ id: 'sc-disabled', usb_port: '1-2.3', enabled: false }),
    ]);

    const findings = await auditScannerPorts(db);

    const dup = findings.find((f) => f.kind === 'duplicate-port');
    expect(dup).toBeDefined();
    expect((dup as any).usbPort).toBe('1-2.3');
    expect((dup as any).scannerIds).toEqual(
      expect.arrayContaining(['sc-enabled', 'sc-disabled'])
    );
  });

  it('reports a disabled row whose port another row now holds as stranded', async () => {
    const { db } = makeDb([
      makeRow({ id: 'sc-old', usb_port: '1-2.3', enabled: false }),
      makeRow({ id: 'sc-new', usb_port: '1-2.3', enabled: true }),
    ]);

    const findings = await auditScannerPorts(db);

    const stranded = findings.find((f) => f.kind === 'stranded-disabled');
    expect(stranded).toBeDefined();
    expect((stranded as any).usbPort).toBe('1-2.3');
    expect((stranded as any).scannerIds).toEqual(
      expect.arrayContaining(['sc-old', 'sc-new'])
    );
  });

  it('does not report a merely retired disabled row as stranded', async () => {
    // `disableStaleScannerRows` disables a row while deliberately preserving
    // its usb_port, so "disabled and holds a port" is the resting state of
    // any scanner ever unplugged or re-cabled. Measured on the production rig
    // 2026-09-17: 12 of 17 rows are in exactly this state, all legitimate
    // history. Reporting them would be pure noise.
    const { db } = makeDb([
      makeRow({ id: 'sc-retired-1', usb_port: '1-10', enabled: false }),
      makeRow({ id: 'sc-retired-2', usb_port: '17-1', enabled: false }),
      makeRow({ id: 'sc-live', usb_port: '9-1', enabled: true }),
    ]);

    const findings = await auditScannerPorts(db);

    expect(findings.filter((f) => f.kind === 'stranded-disabled')).toEqual([]);
    expect(findings).toEqual([]);
  });

  it('reports nothing for a clean installation', async () => {
    const { db } = makeDb([
      makeRow({ id: 'sc-1', usb_port: '1-8', enabled: true }),
      makeRow({ id: 'sc-2', usb_port: '1-9', enabled: true }),
    ]);

    const findings = await auditScannerPorts(db);

    expect(findings).toEqual([]);
  });

  it('never writes to the database', async () => {
    const rows = [
      makeRow({ id: 'sc-1', usb_port: null }),
      makeRow({ id: 'sc-2', usb_port: '1-2.3', enabled: false }),
    ];
    const findMany = vi.fn(async () => rows.map((r) => ({ ...r })));
    const update = vi.fn();
    const create = vi.fn();
    const deleteFn = vi.fn();
    const updateMany = vi.fn();
    const db = {
      graviScanner: { findMany, update, create, delete: deleteFn, updateMany },
    } as any;

    await auditScannerPorts(db);

    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(deleteFn).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('resolves rather than throwing when the database handle is unusable', async () => {
    // main-wiring.test.ts calls initGraviScan with `{}` as the database, and
    // the audit is invoked fire-and-forget — so a throw here would escape as
    // an unhandled rejection at application startup.
    await expect(auditScannerPorts({} as any)).resolves.toEqual([]);
  });

  it('resolves rather than throwing when the query rejects', async () => {
    const db = {
      graviScanner: {
        findMany: vi.fn(async () => {
          throw new Error('SQLITE_BUSY');
        }),
      },
    } as any;

    await expect(auditScannerPorts(db)).resolves.toEqual([]);
  });
});
