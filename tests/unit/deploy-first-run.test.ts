import { describe, it, expect } from 'vitest';
import { isDeployFirstRun } from '../../src/main/deploy-first-run';

describe('isDeployFirstRun', () => {
  it('is true for Squirrel first run during a station deploy', () => {
    expect(
      isDeployFirstRun(['Bloom Desktop.exe', '--squirrel-firstrun'], {
        BLOOM_DEPLOY_SKIP_FIRSTRUN: '1',
      })
    ).toBe(true);
  });

  it('is false for a normal first run (installed by hand)', () => {
    expect(
      isDeployFirstRun(['Bloom Desktop.exe', '--squirrel-firstrun'], {})
    ).toBe(false);
  });

  it('is false for a normal launch even during a deploy', () => {
    expect(
      isDeployFirstRun(['Bloom Desktop.exe'], {
        BLOOM_DEPLOY_SKIP_FIRSTRUN: '1',
      })
    ).toBe(false);
  });

  it('only accepts the exact value 1', () => {
    expect(
      isDeployFirstRun(['Bloom Desktop.exe', '--squirrel-firstrun'], {
        BLOOM_DEPLOY_SKIP_FIRSTRUN: 'true',
      })
    ).toBe(false);
  });
});
