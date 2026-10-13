/**
 * Structure tests for .github/workflows/release.yml: trigger, job order, and
 * least-privilege permissions (only `publish` can write, and it runs no build).
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { load } from 'js-yaml';

const WORKFLOW_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'release.yml'
);

interface Step {
  name?: string;
  uses?: string;
  run?: string;
}

interface Job {
  needs?: string | string[];
  permissions?: Record<string, string>;
  'timeout-minutes'?: number;
  steps?: Step[];
}

interface Workflow {
  on: { push?: { tags?: string[]; branches?: string[] } };
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, Job>;
}

function loadWorkflow(): Workflow {
  return load(fs.readFileSync(WORKFLOW_PATH, 'utf8')) as Workflow;
}

function needsOf(job: string): string[] {
  const needs = loadWorkflow().jobs[job]?.needs;
  return needs === undefined ? [] : Array.isArray(needs) ? needs : [needs];
}

function stepNames(job: string): string[] {
  return (loadWorkflow().jobs[job]?.steps ?? []).map((s) => s.name ?? '');
}

describe('release.yml trigger and concurrency', () => {
  it('runs only on vX.Y.Z tag pushes', () => {
    expect(loadWorkflow().on).toEqual({ push: { tags: ['v*.*.*'] } });
  });

  it('grants no permissions at the workflow level', () => {
    expect(loadWorkflow().permissions).toEqual({});
  });

  it('never cancels a release part-way through', () => {
    expect(loadWorkflow().concurrency['cancel-in-progress']).toBe(false);
  });
});

describe('release.yml job order', () => {
  it.each([
    ['verify', []],
    ['build-python', ['verify']],
    ['build-windows', ['build-python']],
    ['build-linux', ['build-python']],
    ['manifest', ['verify', 'build-windows', 'build-linux']],
    ['publish', ['verify', 'manifest']],
  ])('%s needs %j', (job, expected) => {
    expect(needsOf(job).sort()).toEqual([...expected].sort());
  });

  it('has exactly these jobs', () => {
    expect(Object.keys(loadWorkflow().jobs).sort()).toEqual(
      [
        'build-linux',
        'build-python',
        'build-windows',
        'manifest',
        'publish',
        'verify',
      ].sort()
    );
  });

  it('sets a timeout on every job', () => {
    for (const [name, job] of Object.entries(loadWorkflow().jobs)) {
      expect(job['timeout-minutes'], name).toBeGreaterThan(0);
    }
  });
});

describe('release.yml permissions', () => {
  it('gives only publish write access', () => {
    const writers = Object.entries(loadWorkflow().jobs)
      .filter(([, job]) =>
        Object.values(job.permissions ?? {}).includes('write')
      )
      .map(([name]) => name);
    expect(writers).toEqual(['publish']);
  });

  it('publish has contents: write and nothing else', () => {
    expect(loadWorkflow().jobs.publish.permissions).toEqual({
      contents: 'write',
    });
  });

  it('publish runs no build code: no checkout, no npm, no setup actions', () => {
    const steps = loadWorkflow().jobs.publish.steps ?? [];
    for (const step of steps) {
      expect(step.uses ?? '').not.toMatch(/checkout|setup-node|setup-uv/);
      expect(step.run ?? '').not.toMatch(/\bnpm\b|\bnpx\b|\buv\b/);
    }
  });

  it('publish verifies checksums before creating the release', () => {
    const names = stepNames('publish');
    expect(names.indexOf('Verify checksums')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('Verify checksums')).toBeLessThan(
      names.indexOf('Create GitHub Release')
    );
  });

  it('every other job declares read-only permissions explicitly', () => {
    for (const [name, job] of Object.entries(loadWorkflow().jobs)) {
      if (name === 'publish') continue;
      expect(job.permissions?.contents, name).toBe('read');
    }
  });
});

describe('release.yml verify job', () => {
  it.each([
    'Check tag matches package.json',
    'Check tagged commit is on main',
    'Check "All Checks Passed" succeeded on this commit',
    'Check no release exists for this tag',
  ])('includes "%s"', (step) => {
    expect(stepNames('verify')).toContain(step);
  });

  it('uses the tested release-version helper', () => {
    const step = loadWorkflow().jobs.verify.steps?.find(
      (s) => s.name === 'Check tag matches package.json'
    );
    expect(step?.run).toContain('scripts/release/release-version.ts');
  });
});

describe('release.yml build jobs', () => {
  it('build-windows uses the same make + artifact check as CI', () => {
    const runs = (loadWorkflow().jobs['build-windows'].steps ?? []).map(
      (s) => s.run ?? ''
    );
    expect(runs).toContain('npm run make');
    expect(runs).toContain('npm run test:make:artifacts');
  });

  it('build-linux builds the deb only, like CI', () => {
    const runs = (loadWorkflow().jobs['build-linux'].steps ?? []).map(
      (s) => s.run ?? ''
    );
    expect(runs).toContain('npm run make:linux');
    expect(runs).toContain('npm run test:make:artifacts');
  });

  it('manifest uses the tested release-manifest helper', () => {
    const runs = (loadWorkflow().jobs.manifest.steps ?? [])
      .map((s) => s.run ?? '')
      .join('\n');
    expect(runs).toContain('scripts/release/release-manifest.ts');
  });
});
