/**
 * Structure tests for .github/workflows/deploy.yml: on-demand only, plan before deploy,
 * the station job runs on the planned station's runner and environment with read-only
 * permissions, and inputs never reach a shell as text.
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
  'deploy.yml'
);

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  shell?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Job {
  needs?: string | string[];
  'runs-on': string | string[];
  environment?: string | { name: string; url?: string };
  permissions?: Record<string, string>;
  steps: Step[];
}
interface Workflow {
  on: Record<
    string,
    {
      inputs?: Record<
        string,
        { required?: boolean; type?: string; default?: unknown }
      >;
    }
  >;
  env: Record<string, string>;
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, Job>;
}

const workflow = load(fs.readFileSync(WORKFLOW_PATH, 'utf8')) as Workflow;
const { plan, deploy } = workflow.jobs;

describe('deploy.yml', () => {
  it('only runs on demand, with a required version and station', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    const inputs = workflow.on.workflow_dispatch.inputs ?? {};
    expect(inputs.version?.required).toBe(true);
    expect(inputs.station?.required).toBe(true);
  });

  it('grants nothing by default and never cancels a deploy part-way', () => {
    expect(workflow.permissions).toEqual({});
    expect(workflow.concurrency.group).toContain('inputs.station');
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
  });

  it('has exactly a plan job and a deploy job that needs it', () => {
    expect(Object.keys(workflow.jobs).sort()).toEqual(['deploy', 'plan']);
    expect(deploy.needs).toBe('plan');
  });

  it('plans on a GitHub-hosted runner and refuses anything but main', () => {
    expect(plan['runs-on']).toBe('ubuntu-latest');
    const guard = plan.steps[0];
    expect(guard.if).toBe("github.ref != 'refs/heads/main'");
    expect(guard.run).toContain('exit 1');
  });

  it('runs the station job on the planned runner, in the planned environment', () => {
    expect(deploy['runs-on']).toEqual([
      'self-hosted',
      'windows',
      '${{ needs.plan.outputs.runner_label }}',
    ]);
    expect(deploy.environment).toEqual({
      name: '${{ needs.plan.outputs.environment }}',
      url: '${{ needs.plan.outputs.release_url }}',
    });
  });

  it('only stops for the camera when asked, since cameras are usually off', () => {
    const input = workflow.on.workflow_dispatch.inputs?.require_camera;
    expect(input).toMatchObject({ type: 'boolean', default: false });
    const install = deploy.steps.find((s) =>
      s.run?.includes('deploy-station.ps1')
    );
    expect(install?.env?.REQUIRE_CAMERA).toBe('${{ inputs.require_camera }}');
  });

  it('files every self-test upload under one species', () => {
    expect(workflow.env.TEST_SPECIES).toBe('Sorghum');
    const install = deploy.steps.find((s) =>
      s.run?.includes('deploy-station.ps1')
    );
    expect(install?.run).toContain('-TestSpecies $env:TEST_SPECIES');
  });

  it("upgrades the database with the release tag's migrations", () => {
    const migrations = deploy.steps.find(
      (s) =>
        s.uses?.startsWith('actions/checkout') && s.with?.path === 'release-src'
    );
    expect(migrations?.with).toMatchObject({
      ref: '${{ needs.plan.outputs.tag }}',
      'sparse-checkout': 'prisma',
    });
    const install = deploy.steps.find((s) =>
      s.run?.includes('deploy-station.ps1')
    );
    expect(install?.run).toContain('release-src\\prisma\\schema.prisma');
  });

  it("always attaches the station's deploy logs", () => {
    const logs = deploy.steps.find((s) =>
      s.uses?.startsWith('actions/upload-artifact')
    );
    expect(logs?.if).toBe('always()');
  });

  it('gives the station job read-only access', () => {
    expect(deploy.permissions).toEqual({ contents: 'read' });
    for (const step of deploy.steps.filter((s) =>
      s.uses?.startsWith('actions/checkout')
    )) {
      expect(step.with?.['persist-credentials']).toBe(false);
    }
  });

  it('passes inputs to scripts through env, never as text in a command', () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        expect(step.run ?? '').not.toMatch(/\$\{\{\s*(inputs|needs)\./);
      }
    }
  });

  it('runs the station script with Windows PowerShell', () => {
    const install = deploy.steps.find((s) =>
      s.run?.includes('deploy-station.ps1')
    );
    expect(install?.shell).toBe('powershell');
    expect(install?.run).toContain('exit $LASTEXITCODE');
  });
});
