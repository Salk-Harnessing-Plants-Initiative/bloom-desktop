/**
 * Scanner row helpers for GraviScan: per-scanner upsert, disable-not-delete
 * stale-row handling, per-row disable, and orphan-worker cleanup.
 *
 * Extracted from `scanner-handlers.ts`'s `saveScannersToDB()` so the
 * find-existing/update-or-create logic is unit-testable in isolation and
 * shared with `graviscan:disable-scanner`. Pure async exports with
 * db/coordinator injection — no ipcMain wrappers, matching this package's
 * `scanner-handlers.ts` convention.
 *
 * Disable-not-delete policy (see also the `GraviScanner` doc comment in
 * prisma/schema.prisma): stale scanner rows are never deleted. The Prisma
 * schema has no `ON DELETE CASCADE` from `GraviScan.scanner_id` or
 * `GraviScanPlateAssignment.scanner_id`, so deleting a `GraviScanner` row
 * would orphan any historical scan/plate-assignment referencing it.
 * Instead, rows are marked `enabled: false` and re-enabled on re-detect
 * (the upsert path matches by usb_bus/usb_device or usb_port regardless
 * of the row's current `enabled` value).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { PrismaClient } from '@prisma/client';
import type { GraviScanner } from '../../types/graviscan';
import type { ScanCoordinatorLike } from './session-handlers';

/** Alias matching the brief's naming for the upsert helper's return type. */
export type GraviScannerRow = GraviScanner;

// ---------------------------------------------------------------------------
// upsertScannerRow
// ---------------------------------------------------------------------------

export interface UpsertScannerPayload {
  name: string;
  display_name?: string | null;
  vendor_id: string;
  product_id: string;
  usb_port?: string;
  usb_bus?: number;
  usb_device?: number;
}

/**
 * Upsert a single GraviScanner row by (usb_bus, usb_device) or usb_port.
 *
 * - If a matching row exists (including previously-disabled rows — this is
 *   how re-detected scanners come back online without a duplicate row):
 *   update its fields.
 * - If no matching row exists: create a new row with `enabled: true`.
 */
export async function upsertScannerRow(
  db: PrismaClient,
  payload: UpsertScannerPayload
): Promise<GraviScannerRow> {
  let existing: GraviScannerRow | null = null;

  // Prefer match on (usb_bus, usb_device) — physical USB hardware address.
  if (payload.usb_bus != null && payload.usb_device != null) {
    existing = (await (db as any).graviScanner.findFirst({
      where: {
        usb_bus: payload.usb_bus,
        usb_device: payload.usb_device,
      },
    })) as GraviScannerRow | null;
  }

  // Fallback: match on usb_port (stable across replug, unlike usb_device).
  if (!existing && payload.usb_port) {
    existing = (await (db as any).graviScanner.findFirst({
      where: { usb_port: payload.usb_port },
    })) as GraviScannerRow | null;
    if (existing) {
      console.log(
        '[GraviScan:SAVE] Matched by usb_port fallback:',
        existing.name,
        existing.id,
        `port:${existing.usb_port}`
      );
    }
  }

  if (existing) {
    const updated = await (db as any).graviScanner.update({
      where: { id: existing.id },
      data: {
        name: payload.name,
        display_name: payload.display_name ?? existing.display_name ?? null,
        vendor_id: payload.vendor_id,
        product_id: payload.product_id,
        usb_port: payload.usb_port || null,
        usb_bus: payload.usb_bus || null,
        usb_device: payload.usb_device || null,
        // Critical fix (final-review #1): re-detecting a scanner MUST
        // re-enable it. Without this, a row disabled by
        // disableStaleScannerRows()/validateConfig()/disableScannerById()
        // can never come back — every read path filters `enabled: true`,
        // so it becomes invisible and un-spawnable forever, requiring
        // manual SQL to recover. This is the "re-enabled on re-detect"
        // behavior documented at the top of this file.
        enabled: true,
      },
    });
    console.log('[GraviScan:SAVE] Updated scanner:', {
      id: updated.id,
      name: updated.name,
      usb_bus: updated.usb_bus,
      usb_device: updated.usb_device,
    });
    return updated as GraviScannerRow;
  }

  const created = await (db as any).graviScanner.create({
    data: {
      name: payload.name,
      display_name: payload.display_name || null,
      vendor_id: payload.vendor_id,
      product_id: payload.product_id,
      usb_port: payload.usb_port || null,
      usb_bus: payload.usb_bus || null,
      usb_device: payload.usb_device || null,
      enabled: true,
    },
  });
  console.log('[GraviScan:SAVE] Created scanner:', {
    id: created.id,
    name: created.name,
    usb_bus: created.usb_bus,
    usb_device: created.usb_device,
  });
  return created as GraviScannerRow;
}

// ---------------------------------------------------------------------------
// disableStaleScannerRows
// ---------------------------------------------------------------------------

export interface DisableStaleResult {
  /** scanner_id of every row that was newly disabled by this call */
  disabled: string[];
}

/**
 * Disable (set enabled=false) on every enabled `GraviScanner` row whose
 * `usb_port` is NOT in the provided current-detection set.
 *
 * Rows with a null `usb_port` are NOT touched — they cannot be matched
 * against the detection set and are typically transient partially-saved
 * states (`reset-usb` clears bus/device for re-detection but preserves
 * the port). Already-disabled rows are excluded at the query level.
 *
 * @returns the `id` of each row that was newly disabled.
 */
export async function disableStaleScannerRows(
  db: PrismaClient,
  currentUsbPorts: readonly string[]
): Promise<DisableStaleResult> {
  const enabled = (await (db as any).graviScanner.findMany({
    where: { enabled: true },
  })) as GraviScannerRow[];

  const portSet = new Set(currentUsbPorts);
  const disabled: string[] = [];

  for (const row of enabled) {
    if (row.usb_port === null) continue; // can't match — leave alone
    if (portSet.has(row.usb_port)) continue; // still present

    await (db as any).graviScanner.update({
      where: { id: row.id },
      data: { enabled: false },
    });
    disabled.push(row.id);
  }

  return { disabled };
}

// ---------------------------------------------------------------------------
// disableScannerById
// ---------------------------------------------------------------------------

export type DisableScannerResult = { ok: true } | { ok: false; error: string };

/**
 * Disable a single scanner by ID. Backs the `graviscan:disable-scanner`
 * IPC handler (per-row "Remove" action).
 *
 * Sets `enabled=false` on the matching row and stops the associated
 * worker subprocess if one is running. Idempotent — disabling an
 * already-disabled scanner is a no-op success. Returns
 * `{ok: false, error}` when the row does not exist.
 *
 * The coordinator parameter may be null (e.g., before the coordinator has
 * been created); the DB update still happens.
 */
export async function disableScannerById(
  db: PrismaClient,
  coordinator: ScanCoordinatorLike | null,
  scannerId: string
): Promise<DisableScannerResult> {
  const row = (await (db as any).graviScanner.findUnique({
    where: { id: scannerId },
  })) as GraviScannerRow | null;

  if (!row) {
    return { ok: false, error: `Scanner ${scannerId} not found` };
  }

  if (row.enabled) {
    await (db as any).graviScanner.update({
      where: { id: scannerId },
      data: { enabled: false },
    });
  }

  if (coordinator && coordinator.hasWorker(scannerId)) {
    await coordinator.stopScanner(scannerId);
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// stopWorkersForDisabledScanners
// ---------------------------------------------------------------------------

/**
 * Stop running worker subprocesses for scanner IDs that were just disabled
 * by `disableStaleScannerRows` (or any equivalent caller).
 *
 * Without this, a freshly-disabled scanner whose worker happens to be
 * running keeps holding USB / SANE resources — particularly painful on
 * Linux where `libusb_open` is exclusive per device.
 *
 * Defensive properties:
 *  - Empty input list -> no coordinator interaction at all.
 *  - `coordinator.stopScanner` rejecting for one scanner does NOT
 *    propagate or short-circuit the loop; the others still get stopped.
 */
export async function stopWorkersForDisabledScanners(
  coordinator: ScanCoordinatorLike,
  disabledIds: readonly string[]
): Promise<void> {
  for (const id of disabledIds) {
    if (!coordinator.hasWorker(id)) continue;
    try {
      await coordinator.stopScanner(id);
    } catch (err) {
      // One stuck worker must not derail stopping the others.
      console.error(
        `[stopWorkersForDisabledScanners] Failed to stop worker for ${id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}
