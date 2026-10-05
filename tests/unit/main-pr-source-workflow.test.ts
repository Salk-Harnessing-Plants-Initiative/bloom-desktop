import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { load } from 'js-yaml';

const WORKFLOW_PATH = path.join(
  __dirname,
  '..',
  '..',
  '.github',
  'workflows',
  'main-pr-source.yml'
);

const REPO = 'Salk-Harnessing-Plants-Initiative/bloom-desktop';

interface MainPrSourceWorkflow {
  on: { pull_request?: { branches?: string[]; types?: string[] } };
  permissions: Record<string, string>;
  jobs: Record<
    string,
    {
      name?: string;
      steps?: Array<{
        name?: string;
        run?: string;
        env?: Record<string, string>;
      }>;
    }
  >;
}

function loadWorkflow(): MainPrSourceWorkflow {
  return load(fs.readFileSync(WORKFLOW_PATH, 'utf8')) as MainPrSourceWorkflow;
}

function sourceStep(): { run: string; env?: Record<string, string> } {
  const step = loadWorkflow().jobs['main-pr-source']?.steps?.[0];
  if (!step?.run) {
    throw new Error('source-branch step not found in main-pr-source');
  }
  return step as { run: string; env?: Record<string, string> };
}

/** Runs the step's shell script with the given PR head/base values. */
function runCheck(headRef: string, headRepo: string, baseRepo = REPO) {
  const result = spawnSync('bash', ['-e', '-c', sourceStep().run], {
    env: {
      ...process.env,
      HEAD_REF: headRef,
      HEAD_REPO: headRepo,
      BASE_REPO: baseRepo,
    },
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout };
}

describe('main-pr-source.yml configuration', () => {
  it('parses as valid YAML', () => {
    expect(() => loadWorkflow()).not.toThrow();
  });

  it('runs only on pull requests into main', () => {
    expect(loadWorkflow().on.pull_request?.branches).toEqual(['main']);
  });

  it('re-runs when a PR is edited, so retargeting to main is checked', () => {
    expect(loadWorkflow().on.pull_request?.types).toEqual([
      'opened',
      'synchronize',
      'reopened',
      'edited',
    ]);
  });

  it('grants the workflow token no permissions', () => {
    expect(loadWorkflow().permissions).toEqual({});
  });

  it('names the job "Main PR Source" (the required check name)', () => {
    expect(loadWorkflow().jobs['main-pr-source']?.name).toBe('Main PR Source');
  });

  it('passes PR head/base values through env, not inline in the script', () => {
    const step = sourceStep();
    expect(step.env).toEqual({
      HEAD_REF: '${{ github.head_ref }}',
      HEAD_REPO: '${{ github.event.pull_request.head.repo.full_name }}',
      BASE_REPO: '${{ github.repository }}',
    });
    expect(step.run).not.toContain('${{');
  });
});

describe('main-pr-source.yml source-branch check', () => {
  it('passes for development in this repo', () => {
    const result = runCheck('development', REPO);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Source branch is development.');
  });

  it.each([
    'fix-cylinderscan-camera-ip-from-machine-config',
    'hotfix/camera-ip',
    'main',
    'development-old',
    'Development',
  ])('fails for source branch %s', (headRef) => {
    const result = runCheck(headRef, REPO);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`got ${REPO}:${headRef}`);
  });

  it('fails for a fork branch named development', () => {
    const result = runCheck('development', 'someone/bloom-desktop');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('got someone/bloom-desktop:development');
  });

  it('explains how hotfixes get through', () => {
    const result = runCheck('hotfix/x', REPO);
    expect(result.stdout).toContain('Hotfixes need a maintainer to bypass');
  });
});
