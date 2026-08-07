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

function loadWorkflow(): WorkflowFile {
  return load(fs.readFileSync(WORKFLOW_PATH, 'utf8')) as WorkflowFile;
}

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
  it.each([
    ['test-integration', 15],
    ['test-e2e-dev', 90],
    ['test-make', 20],
    ['test-make-windows', 30],
  ])('sets timeout-minutes on %s to %i', (jobName, expectedMinutes) => {
    const workflow = loadWorkflow();

    expect(workflow.jobs[jobName]).toBeDefined();
    expect(workflow.jobs[jobName]?.['timeout-minutes']).toBe(expectedMinutes);
  });
});
