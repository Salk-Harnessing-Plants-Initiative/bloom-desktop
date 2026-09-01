import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { load } from 'js-yaml';

const WORKFLOW_PATH = path.join(
  __dirname,
  '..',
  '..',
  '.github',
  'workflows',
  'pr-checks.yml'
);

interface WorkflowJob {
  needs?: string | string[];
  'runs-on'?: string;
  'timeout-minutes'?: number;
  strategy?: {
    matrix?: Record<string, unknown>;
  };
  steps?: Array<{
    name?: string;
    run?: string;
    with?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
}

interface WorkflowFile {
  concurrency: {
    group: string;
    'cancel-in-progress': string;
  };
  jobs: Record<string, WorkflowJob | undefined>;
}

const EXPECTED_TIMEOUTS: Record<string, number> = {
  'build-python': 10,
  'test-integration': 15,
  'test-e2e-dev': 90,
  'test-make': 20,
  'test-make-windows': 30,
  'test-make-linux': 20,
};

function loadWorkflow(): WorkflowFile {
  return load(fs.readFileSync(WORKFLOW_PATH, 'utf8')) as WorkflowFile;
}

it('parses as valid YAML', () => {
  expect(() => loadWorkflow()).not.toThrow();
});

describe('pr-checks.yml concurrency configuration', () => {
  it('declares a top-level concurrency block grouped by workflow and ref', () => {
    const workflow = loadWorkflow();

    expect(workflow.concurrency).toBeDefined();
    expect(workflow.concurrency.group).toBe(
      '${{ github.workflow }}-${{ github.ref }}'
    );
  });

  it('cancels in-progress runs only for pull_request events, not push events', () => {
    const workflow = loadWorkflow();

    expect(workflow.concurrency['cancel-in-progress']).toBe(
      "${{ github.event_name == 'pull_request' }}"
    );
  });
});

describe('pr-checks.yml timeout-minutes on jobs exposed to main-push queuing', () => {
  it.each(Object.entries(EXPECTED_TIMEOUTS))(
    'sets timeout-minutes on %s to %i',
    (jobName, expectedMinutes) => {
      const workflow = loadWorkflow();

      expect(workflow.jobs[jobName]).toBeDefined();
      expect(workflow.jobs[jobName]?.['timeout-minutes']).toBe(expectedMinutes);
    }
  );

  it('does not set timeout-minutes on any job outside the exposed set', () => {
    const workflow = loadWorkflow();
    const unexpectedlyBounded = Object.entries(workflow.jobs)
      .filter(([name]) => !(name in EXPECTED_TIMEOUTS))
      .filter(([, job]) => job?.['timeout-minutes'] !== undefined)
      .map(([name]) => name);

    expect(unexpectedlyBounded).toEqual([]);
  });
});

describe('pr-checks.yml test-make-linux job', () => {
  it('needs build-python and runs on ubuntu-latest', () => {
    const workflow = loadWorkflow();
    const job = workflow.jobs['test-make-linux'];

    expect(job).toBeDefined();
    expect(job?.needs).toContain('build-python');
    expect(job?.['runs-on']).toBe('ubuntu-latest');
  });

  it('runs the Linux-scoped make:linux script, not the shared make script', () => {
    const workflow = loadWorkflow();
    const job = workflow.jobs['test-make-linux'];
    const makeStep = (job?.steps ?? []).find((step) =>
      step.run?.includes('make:linux')
    );

    expect(makeStep).toBeDefined();
    expect(makeStep?.run).toContain('npm run make:linux');
  });

  it('runs the launch-verification step under xvfb-run with the sandbox disabled', () => {
    const workflow = loadWorkflow();
    const job = workflow.jobs['test-make-linux'];
    const launchStep = (job?.steps ?? []).find((step) =>
      step.run?.includes('test:package:launch')
    );

    expect(launchStep).toBeDefined();
    expect(launchStep?.run).toContain('xvfb-run');
    expect(
      (launchStep?.env as Record<string, unknown> | undefined)?.[
        'ELECTRON_DISABLE_SANDBOX'
      ]
    ).toBe(1);
  });
});

describe('pr-checks.yml test-e2e-dev sharding', () => {
  it('declares a 4-way shard matrix dimension', () => {
    const workflow = loadWorkflow();
    const job = workflow.jobs['test-e2e-dev'];

    expect(job?.strategy?.matrix?.shard).toEqual([1, 2, 3, 4]);
  });

  it('passes --shard=${{ matrix.shard }}/4 to every Playwright invocation step', () => {
    const workflow = loadWorkflow();
    const job = workflow.jobs['test-e2e-dev'];
    const playwrightSteps = (job?.steps ?? []).filter((step) =>
      step.run?.includes('test:e2e')
    );

    expect(playwrightSteps.length).toBeGreaterThan(0);
    for (const step of playwrightSteps) {
      expect(step.run).toContain('--shard=${{ matrix.shard }}/4');
    }
  });

  it('includes the shard index in the failure-artifact upload name, alongside the OS', () => {
    const workflow = loadWorkflow();
    const job = workflow.jobs['test-e2e-dev'];
    const uploadStep = (job?.steps ?? []).find(
      (step) => step.name === 'Upload Playwright test results'
    );

    expect(uploadStep).toBeDefined();
    const artifactName = uploadStep?.with?.name;
    expect(artifactName).toContain('${{ matrix.os }}');
    expect(artifactName).toContain('${{ matrix.shard }}');
  });
});
