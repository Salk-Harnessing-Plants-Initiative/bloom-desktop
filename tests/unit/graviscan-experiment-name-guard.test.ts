// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { experimentCreateNameError } from '../../src/main/graviscan-experiment-name-guard';

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
