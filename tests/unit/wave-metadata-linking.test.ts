/**
 * Wave-Scoped Metadata Linking Tests
 *
 * Tests the link/unlink/list logic and delete protection for the new
 * GraviExperimentWaveMetadata table.
 *
 * Like reset-usb.test.ts, the IPC handlers are registered inline so we test
 * the logic by reimplementing the handler flow with injected mocks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock data shapes matching Prisma models
// ---------------------------------------------------------------------------

interface MockWaveLink {
  id: string;
  experiment_id: string;
  wave_number: number;
  accession_id: string;
}

interface MockExperiment {
  id: string;
  experiment_type: string;
  accession_id: string | null;
}

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

function createMockDb(opts: {
  experiments?: MockExperiment[];
  waveLinks?: MockWaveLink[];
}) {
  const experiments = [...(opts.experiments ?? [])];
  const waveLinks = [...(opts.waveLinks ?? [])];

  return {
    experiment: {
      count: vi.fn(({ where }: { where: { accession_id: string } }) =>
        Promise.resolve(
          experiments.filter((e) => e.accession_id === where.accession_id).length
        )
      ),
    },
    graviExperimentWaveMetadata: {
      count: vi.fn(({ where }: { where: { accession_id: string } }) =>
        Promise.resolve(
          waveLinks.filter((l) => l.accession_id === where.accession_id).length
        )
      ),
      findUnique: vi.fn(
        ({
          where,
        }: {
          where: {
            experiment_id_wave_number: {
              experiment_id: string;
              wave_number: number;
            };
          };
        }) => {
          const { experiment_id, wave_number } =
            where.experiment_id_wave_number;
          return Promise.resolve(
            waveLinks.find(
              (l) =>
                l.experiment_id === experiment_id &&
                l.wave_number === wave_number
            ) ?? null
          );
        }
      ),
      create: vi.fn(({ data }: { data: Omit<MockWaveLink, 'id'> }) => {
        const newLink: MockWaveLink = {
          id: `link-${waveLinks.length + 1}`,
          ...data,
        };
        waveLinks.push(newLink);
        return Promise.resolve(newLink);
      }),
      delete: vi.fn(
        ({
          where,
        }: {
          where: {
            experiment_id_wave_number: {
              experiment_id: string;
              wave_number: number;
            };
          };
        }) => {
          const { experiment_id, wave_number } =
            where.experiment_id_wave_number;
          const idx = waveLinks.findIndex(
            (l) =>
              l.experiment_id === experiment_id &&
              l.wave_number === wave_number
          );
          if (idx === -1) return Promise.reject(new Error('Not found'));
          const [removed] = waveLinks.splice(idx, 1);
          return Promise.resolve(removed);
        }
      ),
      findMany: vi.fn(
        ({ where }: { where: { experiment_id: string } }) => {
          return Promise.resolve(
            waveLinks.filter((l) => l.experiment_id === where.experiment_id)
          );
        }
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Logic extracted from database-handlers.ts
// ---------------------------------------------------------------------------

async function countMetadataReferences(
  db: ReturnType<typeof createMockDb>,
  accessionId: string
): Promise<number> {
  const [cylRefs, gravRefs] = await Promise.all([
    db.experiment.count({ where: { accession_id: accessionId } }),
    db.graviExperimentWaveMetadata.count({ where: { accession_id: accessionId } }),
  ]);
  return cylRefs + gravRefs;
}

async function linkGraviMetadata(
  db: ReturnType<typeof createMockDb>,
  experimentId: string,
  waveNumber: number,
  accessionId: string
) {
  const existing = await db.graviExperimentWaveMetadata.findUnique({
    where: {
      experiment_id_wave_number: {
        experiment_id: experimentId,
        wave_number: waveNumber,
      },
    },
  });
  if (existing) {
    return {
      success: false,
      error: `Wave ${waveNumber} already has linked metadata. Unlink first.`,
    };
  }
  const link = await db.graviExperimentWaveMetadata.create({
    data: {
      experiment_id: experimentId,
      wave_number: waveNumber,
      accession_id: accessionId,
    },
  });
  return { success: true, data: link };
}

async function unlinkGraviMetadata(
  db: ReturnType<typeof createMockDb>,
  experimentId: string,
  waveNumber: number
) {
  try {
    await db.graviExperimentWaveMetadata.delete({
      where: {
        experiment_id_wave_number: {
          experiment_id: experimentId,
          wave_number: waveNumber,
        },
      },
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function deleteWithProtection(
  db: ReturnType<typeof createMockDb>,
  accessionId: string
) {
  const linkedCount = await countMetadataReferences(db, accessionId);
  if (linkedCount > 0) {
    return {
      success: false,
      error: `Metadata is linked to ${linkedCount} experiment(s). Unlink before deleting.`,
    };
  }
  return { success: true };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('linkGraviMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new wave→metadata link when wave is empty', async () => {
    const db = createMockDb({});
    const result = await linkGraviMetadata(db, 'exp-1', 1, 'acc-1');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      experiment_id: 'exp-1',
      wave_number: 1,
      accession_id: 'acc-1',
    });
  });

  it('refuses to link when the wave is already linked', async () => {
    const db = createMockDb({
      waveLinks: [
        { id: 'link-1', experiment_id: 'exp-1', wave_number: 1, accession_id: 'acc-A' },
      ],
    });
    const result = await linkGraviMetadata(db, 'exp-1', 1, 'acc-B');

    expect(result.success).toBe(false);
    expect(result.error).toContain('already has linked metadata');
    expect(db.graviExperimentWaveMetadata.create).not.toHaveBeenCalled();
  });

  it('allows different waves on the same experiment', async () => {
    const db = createMockDb({
      waveLinks: [
        { id: 'link-1', experiment_id: 'exp-1', wave_number: 1, accession_id: 'acc-A' },
      ],
    });
    const result = await linkGraviMetadata(db, 'exp-1', 2, 'acc-B');

    expect(result.success).toBe(true);
  });

  it('allows the same accession to be linked to multiple experiments', async () => {
    const db = createMockDb({
      waveLinks: [
        { id: 'link-1', experiment_id: 'exp-1', wave_number: 1, accession_id: 'acc-A' },
      ],
    });
    const result = await linkGraviMetadata(db, 'exp-2', 1, 'acc-A');

    expect(result.success).toBe(true);
  });
});

describe('unlinkGraviMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes an existing link', async () => {
    const db = createMockDb({
      waveLinks: [
        { id: 'link-1', experiment_id: 'exp-1', wave_number: 1, accession_id: 'acc-A' },
      ],
    });
    const result = await unlinkGraviMetadata(db, 'exp-1', 1);

    expect(result.success).toBe(true);
    expect(db.graviExperimentWaveMetadata.delete).toHaveBeenCalledOnce();
  });

  it('returns an error when the link does not exist', async () => {
    const db = createMockDb({});
    const result = await unlinkGraviMetadata(db, 'exp-1', 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('countMetadataReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 when accession is unreferenced', async () => {
    const db = createMockDb({});
    expect(await countMetadataReferences(db, 'acc-A')).toBe(0);
  });

  it('counts CylinderScan references via Experiment.accession_id', async () => {
    const db = createMockDb({
      experiments: [
        { id: 'exp-1', experiment_type: 'cylinder', accession_id: 'acc-A' },
        { id: 'exp-2', experiment_type: 'cylinder', accession_id: 'acc-A' },
      ],
    });
    expect(await countMetadataReferences(db, 'acc-A')).toBe(2);
  });

  it('counts GraviScan references via wave links', async () => {
    const db = createMockDb({
      waveLinks: [
        { id: 'link-1', experiment_id: 'exp-1', wave_number: 1, accession_id: 'acc-A' },
        { id: 'link-2', experiment_id: 'exp-1', wave_number: 2, accession_id: 'acc-A' },
      ],
    });
    expect(await countMetadataReferences(db, 'acc-A')).toBe(2);
  });

  it('sums references across both link paths', async () => {
    const db = createMockDb({
      experiments: [
        { id: 'exp-1', experiment_type: 'cylinder', accession_id: 'acc-A' },
      ],
      waveLinks: [
        { id: 'link-1', experiment_id: 'exp-2', wave_number: 1, accession_id: 'acc-A' },
        { id: 'link-2', experiment_id: 'exp-3', wave_number: 1, accession_id: 'acc-A' },
      ],
    });
    expect(await countMetadataReferences(db, 'acc-A')).toBe(3);
  });
});

describe('deleteWithProtection (delete handler logic)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks deletion when accession is referenced by CylinderScan', async () => {
    const db = createMockDb({
      experiments: [
        { id: 'exp-1', experiment_type: 'cylinder', accession_id: 'acc-A' },
      ],
    });
    const result = await deleteWithProtection(db, 'acc-A');

    expect(result.success).toBe(false);
    expect(result.error).toContain('linked to 1 experiment');
  });

  it('blocks deletion when accession is referenced by GraviScan wave link', async () => {
    const db = createMockDb({
      waveLinks: [
        { id: 'link-1', experiment_id: 'exp-1', wave_number: 1, accession_id: 'acc-A' },
      ],
    });
    const result = await deleteWithProtection(db, 'acc-A');

    expect(result.success).toBe(false);
    expect(result.error).toContain('linked to 1 experiment');
  });

  it('reports total count across both link paths', async () => {
    const db = createMockDb({
      experiments: [
        { id: 'exp-1', experiment_type: 'cylinder', accession_id: 'acc-A' },
      ],
      waveLinks: [
        { id: 'link-1', experiment_id: 'exp-2', wave_number: 1, accession_id: 'acc-A' },
      ],
    });
    const result = await deleteWithProtection(db, 'acc-A');

    expect(result.success).toBe(false);
    expect(result.error).toContain('linked to 2 experiment');
  });

  it('allows deletion when no references exist', async () => {
    const db = createMockDb({});
    const result = await deleteWithProtection(db, 'acc-A');

    expect(result.success).toBe(true);
  });

  it('allows deletion after all links are removed', async () => {
    const db = createMockDb({
      waveLinks: [
        { id: 'link-1', experiment_id: 'exp-1', wave_number: 1, accession_id: 'acc-A' },
      ],
    });

    // First attempt — blocked
    const blocked = await deleteWithProtection(db, 'acc-A');
    expect(blocked.success).toBe(false);

    // Unlink, then retry
    await unlinkGraviMetadata(db, 'exp-1', 1);
    const allowed = await deleteWithProtection(db, 'acc-A');
    expect(allowed.success).toBe(true);
  });
});
