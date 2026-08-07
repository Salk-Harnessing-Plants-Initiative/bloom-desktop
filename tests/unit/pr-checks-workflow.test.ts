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

interface WorkflowFile {
  concurrency: {
    group: string;
    'cancel-in-progress': string;
  };
  jobs: Record<string, { 'timeout-minutes'?: number } | undefined>;
}

const EXPECTED_TIMEOUTS: Record<string, number> = {
  'build-python': 10,
  'test-integration': 15,
  'test-e2e-dev': 90,
  'test-make': 20,
  'test-make-windows': 30,
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
