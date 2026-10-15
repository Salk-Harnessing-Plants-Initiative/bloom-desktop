/**
 * Runs the release workflow's "Create draft GitHub Release" step script for
 * real, under bash with GitHub Actions' shell flags, against a fake `gh` on
 * PATH. The fake returns realistic API JSON and runs the workflow's own
 * --jq filters through real jq, so the filters that pick which release to
 * delete are exercised too. Every run's release list also holds a published
 * v0.2.0 and a draft for another version, which must never be touched.
 * Proves an incomplete draft is never left behind: a failed upload, a missing
 * or wrong file, or a draft that can't be found or listed all delete the
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

// Fake gh: logs every call, answers with JSON from FAKE_* variables, and
// applies the caller's --jq filter with real jq, as gh does.
const FAKE_GH = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
filter=""
args=("$@")
for ((i = 0; i < \${#args[@]}; i++)); do
  [[ "\${args[i]}" == --jq ]] && filter="\${args[i + 1]}"
done
reply() {
  if [[ -n "$filter" ]]; then jq -r "$filter" <<< "$1"; else printf '%s' "$1"; fi
}
case "$1 $2" in
  "release create") exit "\${FAKE_CREATE_EXIT:-0}" ;;
esac
if [[ "$*" == *"-X DELETE"* ]]; then exit "\${FAKE_DELETE_EXIT:-0}"; fi
if [[ "$*" == *"/assets"* ]]; then
  [[ "\${FAKE_ASSETS_EXIT:-0}" != 0 ]] && exit "$FAKE_ASSETS_EXIT"
  reply "$FAKE_ASSETS_JSON"
  exit 0
fi
if [[ "$*" == *"/releases"* ]]; then
  n=$(( $(cat "$FAKE_LOOKUPS" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$FAKE_LOOKUPS"
  if (( n <= \${FAKE_LOOKUP_MISSES:-0} )); then
    [[ "\${FAKE_LOOKUP_EXIT:-0}" != 0 ]] && exit "$FAKE_LOOKUP_EXIT"
    reply "$FAKE_DECOYS_JSON"
    exit 0
  fi
  reply "$FAKE_RELEASES_JSON"
  exit 0
fi
exit 0
`;

// Releases that must never be selected: a published v0.2.0 and a draft for
// a different version.
const DECOY_RELEASES = [
  { id: 7, tag_name: 'v0.2.0', draft: false },
  { id: 9, tag_name: 'v0.1.9', draft: true },
];

// Fake sleep: records the delay instead of waiting.
const FAKE_SLEEP = `#!/usr/bin/env bash
echo "sleep $*" >> "$FAKE_LOG"
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
  fs.writeFileSync(path.join(dir, 'bin', 'sleep'), FAKE_SLEEP, { mode: 0o755 });
  fs.mkdirSync(path.join(dir, 'release-bundle'));
  for (const name of BUNDLE) {
    fs.writeFileSync(path.join(dir, 'release-bundle', name), 'x');
  }
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

interface FakeOptions {
  /** Id of the v0.2.0 draft in the release list; empty for no draft. */
  draftId?: string;
  /** Names of the files attached to the draft. */
  assets?: string[];
  [variable: string]: string | string[] | undefined;
}

function runStep({ draftId = '', assets = [], ...vars }: FakeOptions) {
  const log = path.join(dir, 'gh.log');
  const releases = draftId
    ? [
        ...DECOY_RELEASES,
        { id: Number(draftId), tag_name: 'v0.2.0', draft: true },
      ]
    : DECOY_RELEASES;
  const fake: Record<string, string> = {
    FAKE_DECOYS_JSON: JSON.stringify(DECOY_RELEASES),
    FAKE_RELEASES_JSON: JSON.stringify(releases),
    FAKE_ASSETS_JSON: JSON.stringify(
      assets.map((name) => ({ name, state: 'uploaded' }))
    ),
  };
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value === 'string') fake[key] = value;
  }
  const result = spawnSync(
    'bash',
    ['--noprofile', '--norc', '-eo', 'pipefail', '-c', draftStepScript()],
    {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`,
        FAKE_LOG: log,
        FAKE_LOOKUPS: path.join(dir, 'lookups'),
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

const touchedDecoy = (calls: string[]) =>
  calls.some((c) => /releases\/(7|9)(\/|$)/.test(c));

describe('Create draft GitHub Release step', () => {
  it('never deletes or inspects the published v0.2.0 or another draft', () => {
    for (const scenario of [
      { draftId: '42', assets: BUNDLE },
      { draftId: '42', FAKE_CREATE_EXIT: '1' },
      { draftId: '42', assets: BUNDLE.slice(1) },
      { draftId: '', FAKE_CREATE_EXIT: '1' },
    ]) {
      const { calls } = runStep(scenario);
      expect(touchedDecoy(calls), JSON.stringify(scenario)).toBe(false);
    }
  });

  it('deletes the draft when one file has a different name but the count matches', () => {
    const { status, out, calls } = runStep({
      draftId: '42',
      assets: BUNDLE.map((n) =>
        n === 'Bloom-Desktop-0.2.0-Setup.exe'
          ? 'Bloom.Desktop-0.2.0-Setup.exe'
          : n
      ),
    });
    expect(status).toBe(1);
    expect(out).toContain("doesn't have exactly the bundle's files");
    expect(deleted(calls)).toBe(true);
  });

  it('succeeds and keeps the draft when every file is attached', () => {
    const { status, out, calls } = runStep({
      draftId: '42',
      assets: BUNDLE,
    });
    expect(status).toBe(0);
    expect(out).toContain('Draft v0.2.0 created with every file');
    expect(deleted(calls)).toBe(false);
  });

  it('creates a draft pinned to the built commit, never a published release', () => {
    const { calls } = runStep({
      draftId: '42',
      assets: BUNDLE,
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
      draftId: '42',
      assets: BUNDLE,
    });
    expect(calls.find((c) => c.startsWith('release create'))).toContain(
      '--prerelease=true'
    );
  });

  it('deletes the draft and fails when the upload fails', () => {
    const { status, out, calls } = runStep({
      FAKE_CREATE_EXIT: '1',
      draftId: '42',
      assets: BUNDLE.slice(0, 3),
    });
    expect(status).toBe(1);
    expect(out).toContain('the upload failed');
    expect(out).toContain('Deleted the incomplete draft for v0.2.0');
    expect(deleted(calls)).toBe(true);
  });

  it('deletes the draft and fails when a file is missing', () => {
    const { status, out, calls } = runStep({
      draftId: '42',
      assets: BUNDLE.filter((n) => n !== 'SHA256SUMS'),
    });
    expect(status).toBe(1);
    expect(out).toContain("doesn't have exactly the bundle's files");
    expect(deleted(calls)).toBe(true);
  });

  it('deletes the draft and fails when an extra file is attached', () => {
    const { status, calls } = runStep({
      draftId: '42',
      assets: [...BUNDLE, 'stray.txt'],
    });
    expect(status).toBe(1);
    expect(deleted(calls)).toBe(true);
  });

  it("deletes the draft and fails when its files can't be listed", () => {
    const { status, out, calls } = runStep({
      draftId: '42',
      FAKE_ASSETS_EXIT: '1',
    });
    expect(status).toBe(1);
    expect(out).toContain("couldn't be listed");
    expect(deleted(calls)).toBe(true);
  });

  it("fails without deleting anything when the draft can't be found", () => {
    const { status, out, calls } = runStep({ draftId: '' });
    expect(status).toBe(1);
    expect(out).toContain("the draft wasn't found");
    expect(out).toContain(
      "Couldn't find the draft for v0.2.0 to delete it. If a draft for v0.2.0 is on the Releases page, delete it"
    );
    expect(out).not.toContain('Deleted the incomplete draft');
    expect(calls.some((c) => c.includes('-X DELETE'))).toBe(false);
  });

  it('looks the draft up 3 times, 5 seconds apart, before giving up', () => {
    const { calls } = runStep({ draftId: '' });
    const lookups = calls.filter((c) =>
      c.startsWith('api --paginate repos/org/repo/releases ')
    );
    expect(lookups).toHaveLength(3);
    expect(calls.filter((c) => c === 'sleep 5')).toHaveLength(2);
  });

  it('finds a draft that only appears on a later lookup', () => {
    const { status, calls } = runStep({
      FAKE_LOOKUP_MISSES: '2',
      draftId: '42',
      assets: BUNDLE,
    });
    expect(status).toBe(0);
    expect(deleted(calls)).toBe(false);
  });

  it('retries a failing lookup, then deletes the incomplete draft', () => {
    const { status, out, calls } = runStep({
      FAKE_CREATE_EXIT: '1',
      FAKE_LOOKUP_MISSES: '1',
      FAKE_LOOKUP_EXIT: '1',
      draftId: '42',
    });
    expect(status).toBe(1);
    expect(deleted(calls)).toBe(true);
    expect(out).toContain('Deleted the incomplete draft for v0.2.0');
  });

  it("says nothing was deleted when the upload failed and the draft can't be found", () => {
    const { status, out, calls } = runStep({
      FAKE_CREATE_EXIT: '1',
      FAKE_LOOKUP_MISSES: '3',
      FAKE_LOOKUP_EXIT: '1',
      draftId: '42',
    });
    expect(status).toBe(1);
    expect(out).toContain('the upload failed');
    expect(out).toContain("Couldn't find the draft for v0.2.0 to delete it");
    expect(out).not.toContain('Deleted the incomplete draft');
    expect(deleted(calls)).toBe(false);
  });

  it('fails and says to delete the draft by hand when deleting fails', () => {
    const { status, out } = runStep({
      FAKE_CREATE_EXIT: '1',
      FAKE_DELETE_EXIT: '1',
      draftId: '42',
    });
    expect(status).toBe(1);
    expect(out).toContain("Couldn't delete the incomplete draft for v0.2.0");
    expect(out).not.toContain('Deleted the incomplete draft');
  });
});
