/**
 * Structure tests for .github/workflows/release.yml: on-demand trigger, job
 * order, least-privilege permissions (only `publish` can write, and it runs no
 * build), the approval gate, and that every safety check stays in place.
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
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  'continue-on-error'?: boolean | string;
}

interface Job {
  if?: string;
  environment?: string | { name: string };
  'continue-on-error'?: boolean | string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  'timeout-minutes'?: number;
  steps?: Step[];
}

interface Workflow {
  on: {
    push?: unknown;
    workflow_dispatch?: {
      inputs?: Record<string, { required?: boolean; type?: string }>;
    };
  };
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
  it('runs only on demand (Run workflow), not on pushes', () => {
    expect(Object.keys(loadWorkflow().on)).toEqual(['workflow_dispatch']);
  });

  it('asks for the version to release, as required text', () => {
    expect(loadWorkflow().on.workflow_dispatch?.inputs?.version).toMatchObject({
      required: true,
      type: 'string',
    });
  });

  it('runs one release at a time', () => {
    expect(loadWorkflow().concurrency.group).toBe('release');
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
    'Check the workflow was started from main',
    'Check version matches package.json',
    'Check "All Checks Passed" succeeded on this commit',
    "Check this version isn't released or tagged yet",
  ])('includes "%s"', (step) => {
    expect(stepNames('verify')).toContain(step);
  });

  it('uses the tested release-version helper', () => {
    const step = loadWorkflow().jobs.verify.steps?.find(
      (s) => s.name === 'Check version matches package.json'
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

function step(job: string, name: string): Step {
  const found = loadWorkflow().jobs[job]?.steps?.find((s) => s.name === name);
  if (!found) {
    throw new Error(`step "${name}" not found in ${job}`);
  }
  return found;
}

function allSteps(): Array<[string, Step]> {
  return Object.entries(loadWorkflow().jobs).flatMap(([job, j]) =>
    (j.steps ?? []).map((s): [string, Step] => [job, s])
  );
}

describe('release.yml safety checks cannot be silently weakened', () => {
  it('no job or step is allowed to fail without failing the release', () => {
    for (const [name, job] of Object.entries(loadWorkflow().jobs)) {
      expect(job['continue-on-error'], name).toBeUndefined();
    }
    for (const [job, s] of allSteps()) {
      expect(s['continue-on-error'], `${job}: ${s.name}`).toBeUndefined();
    }
  });

  it('no job or step is conditional, so no check can be skipped', () => {
    for (const [name, job] of Object.entries(loadWorkflow().jobs)) {
      expect(job.if, name).toBeUndefined();
    }
    for (const [job, s] of allSteps()) {
      expect(s.if, `${job}: ${s.name}`).toBeUndefined();
    }
  });

  it('never interpolates ${{ }} expressions into run scripts', () => {
    for (const [job, s] of allSteps()) {
      expect(s.run ?? '', `${job}: ${s.name}`).not.toContain('${{');
    }
  });

  it('only verify and publish get a token, and no job uses secrets', () => {
    for (const [job, s] of allSteps()) {
      const text = JSON.stringify(s);
      expect(text, `${job}: ${s.name}`).not.toMatch(/secrets\./);
      if (!['verify', 'publish'].includes(job)) {
        expect(text, `${job}: ${s.name}`).not.toContain('github.token');
      }
    }
  });

  it('publish only downloads the bundle, checks it, and creates the release', () => {
    const steps = loadWorkflow().jobs.publish.steps ?? [];
    expect(steps.map((s) => s.uses).filter(Boolean)).toEqual([
      'actions/download-artifact@v4',
    ]);
    expect(steps.map((s) => s.name)).toEqual([
      'Download release bundle',
      'Verify checksums',
      'Create release tag at the built commit',
      'Create GitHub Release',
    ]);
  });

  it('publish verifies the bundle against SHA256SUMS', () => {
    expect(step('publish', 'Verify checksums').run).toBe(
      'sha256sum -c SHA256SUMS'
    );
  });

  it('publish creates the tag at the built commit with a create-only call', () => {
    const create = step('publish', 'Create release tag at the built commit');
    expect(create.run).toBe(
      'gh api "repos/$GITHUB_REPOSITORY/git/refs" -f "ref=refs/tags/$TAG" -f "sha=$GITHUB_SHA"'
    );
    expect(create.env?.TAG).toBe('${{ needs.verify.outputs.tag }}');
  });

  it('publish creates the release only from that tag', () => {
    expect(step('publish', 'Create GitHub Release').run).toContain(
      '--verify-tag'
    );
  });

  it('publish waits for approval in the release environment', () => {
    expect(loadWorkflow().jobs.publish.environment).toBe('release');
  });

  it('no other job uses an environment', () => {
    for (const [name, job] of Object.entries(loadWorkflow().jobs)) {
      if (name === 'publish') continue;
      expect(job.environment, name).toBeUndefined();
    }
  });

  it('every checkout pins the commit the run started on', () => {
    const checkouts = allSteps().filter(([, s]) =>
      (s.uses ?? '').startsWith('actions/checkout')
    );
    expect(checkouts.length).toBeGreaterThan(0);
    for (const [job, s] of checkouts) {
      expect(s.with?.ref, job).toBe('${{ github.sha }}');
    }
  });

  it('the version check writes outputs with the tested helper', () => {
    const check = step('verify', 'Check version matches package.json');
    expect(check.run).toBe(
      'npx ts-node scripts/release/release-version.ts "$VERSION" --github-output'
    );
    expect(check.env?.VERSION).toBe('${{ inputs.version }}');
  });

  it.each([
    'Check the workflow was started from main',
    'Check "All Checks Passed" succeeded on this commit',
    "Check this version isn't released or tagged yet",
  ])('"%s" fails the job when the check fails', (name) => {
    expect(step('verify', name).run).toContain('exit 1');
  });

  it('only releases runs started from main', () => {
    expect(
      step('verify', 'Check the workflow was started from main').run
    ).toContain('"$GITHUB_REF" != "refs/heads/main"');
  });

  it('checks both the release and the tag are free', () => {
    const run =
      step('verify', "Check this version isn't released or tagged yet").run ??
      '';
    expect(run).toContain('gh release view "$TAG"');
    expect(run).toContain('git/ref/tags/$TAG');
  });

  it('trusts only the newest GitHub Actions "All Checks Passed" run', () => {
    const run = step(
      'verify',
      'Check "All Checks Passed" succeeded on this commit'
    ).run;
    expect(run).toContain('app_id=15368');
    expect(run).toContain('sort_by(.started_at) | last');
    expect(run).toContain('"completed success"');
  });

  it('manifest takes the version and tag from verify', () => {
    expect(step('manifest', 'Write manifest.json and SHA256SUMS').env).toEqual({
      TAG: '${{ needs.verify.outputs.tag }}',
      VERSION: '${{ needs.verify.outputs.version }}',
    });
  });
});
