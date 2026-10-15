/**
 * Runs the release workflow's "Create draft GitHub Release" step script for
 * real, under bash with GitHub Actions' shell flags, against a fake `gh` on
 * PATH. Proves an incomplete draft is never left behind: a failed upload, a
 * missing file, or a draft that can't be found or listed all delete the
 * draft (when it exists) and fail the step.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
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

const BUNDLE = [
  'Bloom-Desktop-0.2.0-Setup.exe',
  'RELEASES',
  'SHA256SUMS',
  'bloom-desktop_0.2.0_amd64.deb',
  'bloom_desktop-0.2.0-full.nupkg',
  'manifest.json',
];

// Fake gh: logs every call, and answers from FAKE_* environment variables.
const FAKE_GH = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
case "$1 $2" in
  "release create") exit "\${FAKE_CREATE_EXIT:-0}" ;;
esac
if [[ "$*" == *"-X DELETE"* ]]; then exit "\${FAKE_DELETE_EXIT:-0}"; fi
if [[ "$*" == *"/assets"* ]]; then
  [[ "\${FAKE_ASSETS_EXIT:-0}" != 0 ]] && exit "$FAKE_ASSETS_EXIT"
  printf '%s' "$FAKE_ASSETS"
  exit 0
fi
if [[ "$*" == *"/releases"* ]]; then printf '%s' "$FAKE_RELEASE_ID"; exit 0; fi
exit 0
`;

interface Step {
  name?: string;
  run?: string;
}

function draftStepScript(): string {
  const workflow = load(fs.readFileSync(WORKFLOW_PATH, 'utf8')) as {
    jobs: Record<string, { steps?: Step[] }>;
  };
  const step = workflow.jobs.publish.steps?.find(
    (s) => s.name === 'Create draft GitHub Release'
  );
  if (!step?.run) throw new Error('draft step not found');
  return step.run;
}

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-draft-step-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin', 'gh'), FAKE_GH, { mode: 0o755 });
  fs.mkdirSync(path.join(dir, 'release-bundle'));
  for (const name of BUNDLE) {
    fs.writeFileSync(path.join(dir, 'release-bundle', name), 'x');
  }
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function runStep(fake: Record<string, string>) {
  const log = path.join(dir, 'gh.log');
  const result = spawnSync(
    'bash',
    ['--noprofile', '--norc', '-eo', 'pipefail', '-c', draftStepScript()],
    {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`,
        FAKE_LOG: log,
        TAG: 'v0.2.0',
        PRERELEASE: 'false',
        GITHUB_SHA: 'abc1234',
        GITHUB_REPOSITORY: 'org/repo',
        ...fake,
      },
    }
  );
  const calls = fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').trim().split('\n')
    : [];
  return { status: result.status, out: result.stdout + result.stderr, calls };
}

const deleted = (calls: string[]) =>
  calls.some((c) => c.includes('-X DELETE repos/org/repo/releases/42'));

describe('Create draft GitHub Release step', () => {
  it('succeeds and keeps the draft when every file is attached', () => {
    const { status, out, calls } = runStep({
      FAKE_RELEASE_ID: '42',
      FAKE_ASSETS: BUNDLE.join('\n'),
    });
    expect(status).toBe(0);
    expect(out).toContain('Draft v0.2.0 created with every file');
    expect(deleted(calls)).toBe(false);
  });

  it('creates a draft pinned to the built commit, never a published release', () => {
    const { calls } = runStep({
      FAKE_RELEASE_ID: '42',
      FAKE_ASSETS: BUNDLE.join('\n'),
    });
    const create = calls.find((c) => c.startsWith('release create'));
    expect(create).toContain('--draft');
    expect(create).not.toMatch(/--draft=(false|0)/);
    expect(create).toContain('--target abc1234');
    expect(create).toContain('--prerelease=false');
  });

  it('passes --prerelease=true for a pre-release', () => {
    const { calls } = runStep({
      PRERELEASE: 'true',
      FAKE_RELEASE_ID: '42',
      FAKE_ASSETS: BUNDLE.join('\n'),
    });
    expect(calls.find((c) => c.startsWith('release create'))).toContain(
      '--prerelease=true'
    );
  });

  it('deletes the draft and fails when the upload fails', () => {
    const { status, out, calls } = runStep({
      FAKE_CREATE_EXIT: '1',
      FAKE_RELEASE_ID: '42',
      FAKE_ASSETS: BUNDLE.slice(0, 3).join('\n'),
    });
    expect(status).toBe(1);
    expect(out).toContain('the upload failed');
    expect(deleted(calls)).toBe(true);
  });

  it('deletes the draft and fails when a file is missing', () => {
    const { status, out, calls } = runStep({
      FAKE_RELEASE_ID: '42',
      FAKE_ASSETS: BUNDLE.filter((n) => n !== 'SHA256SUMS').join('\n'),
    });
    expect(status).toBe(1);
    expect(out).toContain("doesn't have exactly the bundle's files");
    expect(deleted(calls)).toBe(true);
  });

  it('deletes the draft and fails when an extra file is attached', () => {
    const { status, calls } = runStep({
      FAKE_RELEASE_ID: '42',
      FAKE_ASSETS: [...BUNDLE, 'stray.txt'].join('\n'),
    });
    expect(status).toBe(1);
    expect(deleted(calls)).toBe(true);
  });

  it("deletes the draft and fails when its files can't be listed", () => {
    const { status, out, calls } = runStep({
      FAKE_RELEASE_ID: '42',
      FAKE_ASSETS_EXIT: '1',
    });
    expect(status).toBe(1);
    expect(out).toContain("couldn't be listed");
    expect(deleted(calls)).toBe(true);
  });

  it("fails without deleting anything when the draft can't be found", () => {
    const { status, out, calls } = runStep({ FAKE_RELEASE_ID: '' });
    expect(status).toBe(1);
    expect(out).toContain("the draft wasn't found");
    expect(calls.some((c) => c.includes('-X DELETE'))).toBe(false);
  });

  it('fails and says to delete the draft by hand when deleting fails', () => {
    const { status, out } = runStep({
      FAKE_CREATE_EXIT: '1',
      FAKE_DELETE_EXIT: '1',
      FAKE_RELEASE_ID: '42',
    });
    expect(status).toBe(1);
    expect(out).toContain("Couldn't delete the incomplete draft v0.2.0");
  });
});
