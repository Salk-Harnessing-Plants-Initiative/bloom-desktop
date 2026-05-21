/**
 * Per-scanner upsert helper for `graviscan:save-scanners-db`.
 *
 * Extracted from graviscan-handlers.ts so the upsert logic is unit-testable.
 * Find-existing precedence: (usb_bus, usb_device) first, then usb_port
 * fallback. Update preserves DB-side defaults for fields not in the
 * payload. Create uses 4grid as the schema-side default for grid_mode.
 *
 * The grid_mode persistence fix (#231) lives here: both UPDATE and CREATE
 * Prisma data blocks now include grid_mode, with payload value taking
 * precedence and a conservative fallback if absent.
 */

import type { PrismaClient } from '@prisma/client';

type GraviScannerRow = {
  id: string;
  name: string;
  display_name: string | null;
  vendor_id: string;
  product_id: string;
  usb_port: string | null;
  usb_bus: number | null;
  usb_device: number | null;
  grid_mode: string;
  enabled: boolean;
};

export interface UpsertScannerPayload {
  name: string;
  display_name?: string | null;
  vendor_id: string;
  product_id: string;
  usb_port?: string;
  usb_bus?: number;
  usb_device?: number;
  /** Optional. If omitted on UPDATE the existing DB value is preserved;
   * if omitted on CREATE the schema default ("4grid") is used. */
  grid_mode?: string;
}

/**
 * Upsert a single GraviScanner row by (usb_bus, usb_device) or usb_port.
 *
 * - If a matching row exists: update its fields. `grid_mode` falls back
 *   to the existing value when the payload omits it (so absent fields
 *   do not blow away the operator's previous selection).
 * - If no matching row exists: create a new row with `enabled = true`
 *   and `grid_mode` defaulting to "4grid" if the payload omits it.
 */
export async function upsertScannerRow(
  db: PrismaClient,
  payload: UpsertScannerPayload,
): Promise<GraviScannerRow> {
  let existing: GraviScannerRow | null = null;

  // Prefer match on (usb_bus, usb_device) — physical USB hardware address.
  if (payload.usb_bus != null && payload.usb_device != null) {
    existing = (await db.graviScanner.findFirst({
      where: {
        usb_bus: payload.usb_bus,
        usb_device: payload.usb_device,
      },
    })) as GraviScannerRow | null;
  }

  // Fallback: match on usb_port (stable across replug, unlike usb_device).
  if (!existing && payload.usb_port) {
    existing = (await db.graviScanner.findFirst({
      where: { usb_port: payload.usb_port },
    })) as GraviScannerRow | null;
  }

  if (existing) {
    const updated = await db.graviScanner.update({
      where: { id: existing.id },
      data: {
        name: payload.name,
        display_name:
          payload.display_name ?? existing.display_name ?? null,
        vendor_id: payload.vendor_id,
        product_id: payload.product_id,
        usb_port: payload.usb_port ?? null,
        usb_bus: payload.usb_bus ?? null,
        usb_device: payload.usb_device ?? null,
        // #231 fix: persist grid_mode on UPDATE. Fall back to the existing
        // row's value when the payload omits the field so we don't clobber
        // a previously-saved operator selection.
        grid_mode: payload.grid_mode ?? existing.grid_mode,
      },
    });
    return updated as GraviScannerRow;
  }

  const created = await db.graviScanner.create({
    data: {
      name: payload.name,
      display_name: payload.display_name ?? null,
      vendor_id: payload.vendor_id,
      product_id: payload.product_id,
      usb_port: payload.usb_port ?? null,
      usb_bus: payload.usb_bus ?? null,
      usb_device: payload.usb_device ?? null,
      enabled: true,
      // #231 fix: persist grid_mode on CREATE. Fall back to "4grid" (the
      // schema default) when the payload omits the field.
      grid_mode: payload.grid_mode ?? '4grid',
    },
  });
  return created as GraviScannerRow;
}
