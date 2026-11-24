/**
 * Unit tests: an accession file whose experiments have scans can't be deleted.
 */
import { describe, it, expect, vi } from 'vitest';
import { accessionDeleteRefusal } from '../../src/main/accession-delete-guard';

const dbWith = (
  experiments: Array<{ name: string; scans: number; graviScans?: number }>
) => ({
  experiment: {
    findMany: vi.fn().mockResolvedValue(
      experiments.map((e) => ({
        name: e.name,
        _count: { scans: e.scans, graviScans: e.graviScans ?? 0 },
      }))
    ),
  },
});

describe('accessionDeleteRefusal', () => {
  it('allows a file no experiment uses, or whose experiments have no scans', async () => {
    expect(await accessionDeleteRefusal(dbWith([]), 'acc-1')).toBeNull();
    expect(
      await accessionDeleteRefusal(
        dbWith([{ name: '2026-12-01 STL Soy W2', scans: 0 }]),
        'acc-1'
      )
    ).toBeNull();
  });

  it('refuses when an experiment using it has scans, naming each with its count', async () => {
    const db = dbWith([
      { name: '2026-11-10 STL Soy', scans: 24 },
      { name: '2026-12-01 STL Soy W2', scans: 0 },
      { name: 'Gravi plates', scans: 0, graviScans: 1 },
    ]);
    expect(await accessionDeleteRefusal(db, 'acc-1')).toBe(
      "This accession file can't be deleted: experiments that use it have scans: 2026-11-10 STL Soy (24 scans), Gravi plates (1 scan)."
    );
    // Only this file's experiments, counting non-deleted scans.
    const args = db.experiment.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ accession_id: 'acc-1' });
    expect(args.select._count.select.scans).toEqual({
      where: { deleted: false },
    });
  });
});
