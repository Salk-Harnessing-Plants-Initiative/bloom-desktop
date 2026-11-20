// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  experimentCreateNameError,
  experimentUpdateNameError,
  type ExperimentLookupLike,
} from '../../src/main/graviscan-experiment-name-guard';

function fakeDb(
  existing: { name: string; experiment_type: string } | null
): ExperimentLookupLike {
  return {
    experiment: {
      findUnique: vi.fn().mockResolvedValue(existing),
    },
  };
}

describe('experimentCreateNameError', () => {
  it('refuses a GraviScan experiment whose name has a marker word', () => {
    expect(
      experimentCreateNameError({
        name: 'Plot st 2',
        experiment_type: 'graviscan',
      })
    ).toContain('"st"');
  });

  it('allows a GraviScan experiment with a normal name', () => {
    expect(
      experimentCreateNameError({
        name: 'Perceptome Screen',
        experiment_type: 'graviscan',
      })
    ).toBeNull();
  });

  it('does not check CylinderScan experiments', () => {
    expect(
      experimentCreateNameError({
        name: 'Plot st 2',
        experiment_type: 'cylinderscan',
      })
    ).toBeNull();
  });

  it('does not check an experiment with no type (defaults to CylinderScan)', () => {
    expect(experimentCreateNameError({ name: 'Trial cy1' })).toBeNull();
  });
});

describe('experimentUpdateNameError', () => {
  it('refuses renaming a GraviScan experiment to a marker name', async () => {
    const db = fakeDb({ name: 'Old', experiment_type: 'graviscan' });
    expect(
      await experimentUpdateNameError(db, 'id1', { name: 'Trial cy1' })
    ).toContain('"cy1"');
  });

  it('understands the Prisma { set } form', async () => {
    const db = fakeDb({ name: 'Old', experiment_type: 'graviscan' });
    expect(
      await experimentUpdateNameError(db, 'id1', { name: { set: 'Test Sc2' } })
    ).toContain('"Sc2"');
  });

  it('allows renaming a CylinderScan experiment to anything', async () => {
    const db = fakeDb({ name: 'Old', experiment_type: 'cylinderscan' });
    expect(
      await experimentUpdateNameError(db, 'id1', { name: 'Trial cy1' })
    ).toBeNull();
  });

  it('refuses turning an experiment into GraviScan when its name has a marker', async () => {
    const db = fakeDb({ name: 'Plot st 2', experiment_type: 'cylinderscan' });
    expect(
      await experimentUpdateNameError(db, 'id1', {
        experiment_type: 'graviscan',
      })
    ).toContain('"st"');
  });

  it('leaves an existing GraviScan experiment alone when the name is not changed', async () => {
    const db = fakeDb({ name: 'Trial_cy1', experiment_type: 'graviscan' });
    expect(
      await experimentUpdateNameError(db, 'id1', { accession: {} })
    ).toBeNull();
    expect(db.experiment.findUnique).not.toHaveBeenCalled();
  });

  it('does not block when the experiment is not found (the update itself will fail)', async () => {
    const db = fakeDb(null);
    expect(
      await experimentUpdateNameError(db, 'missing', { name: 'Trial cy1' })
    ).toBeNull();
  });
});
