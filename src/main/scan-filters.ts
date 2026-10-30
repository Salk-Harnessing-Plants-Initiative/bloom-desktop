/**
 * Browse Scans' filters as a database query: scans not deleted, optionally of one
 * experiment and within a date range (local days, both ends inclusive).
 */

import type { ScanListFilters } from '../types/upload-all';

export interface ScanWhere {
  deleted: boolean;
  experiment_id?: string;
  capture_date?: { gte?: Date; lte?: Date };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The query for these filters, or why the filters can't be used. */
export function scanListWhere(
  filters: ScanListFilters = {}
): { where: ScanWhere } | { error: string } {
  const where: ScanWhere = { deleted: false };
  if (filters.experimentId) where.experiment_id = filters.experimentId;
  if (filters.dateFrom && !DATE_PATTERN.test(filters.dateFrom)) {
    return {
      error: `Invalid dateFrom format: "${filters.dateFrom}". Expected YYYY-MM-DD.`,
    };
  }
  if (filters.dateTo && !DATE_PATTERN.test(filters.dateTo)) {
    return {
      error: `Invalid dateTo format: "${filters.dateTo}". Expected YYYY-MM-DD.`,
    };
  }
  if (filters.dateFrom || filters.dateTo) {
    // A plain date parses as UTC midnight; these are local days.
    where.capture_date = {};
    if (filters.dateFrom) {
      where.capture_date.gte = new Date(`${filters.dateFrom}T00:00:00`);
    }
    if (filters.dateTo) {
      where.capture_date.lte = new Date(`${filters.dateTo}T23:59:59.999`);
    }
  }
  return { where };
}
