/**
 * Tests for scripts/release/station-versions.ts: reading the version from a deploy's
 * release link, picking the newest successful deploy, and the summary table.
 */
import { describe, it, expect } from 'vitest';
import {
  activeStations,
  formatStationTable,
  latestSuccessfulDeploy,
  versionFromReleaseUrl,
  type StationLike,
} from '../../../scripts/release/station-versions';

const REPO = 'Salk-Harnessing-Plants-Initiative/bloom-desktop';
const releaseUrl = (v: string) =>
  `https://github.com/${REPO}/releases/tag/v${v}`;
const PC1: StationLike = {
  name: 'pc1',
  location: 'WIF room 104/105',
  bloom_scanner_name: 'FastScanner',
  environment: 'station-pc1',
  active: true,
};

describe('versionFromReleaseUrl', () => {
  it('reads the version from a release page link', () => {
    expect(versionFromReleaseUrl(releaseUrl('0.2.1'))).toBe('0.2.1');
  });

  it('reads pre-releases too', () => {
    expect(versionFromReleaseUrl(releaseUrl('0.2.1-rc.1'))).toBe('0.2.1-rc.1');
  });

  it('is null for anything else', () => {
    expect(versionFromReleaseUrl(undefined)).toBeNull();
    expect(versionFromReleaseUrl('https://example.com/v0.2.1')).toBeNull();
  });
});

describe('latestSuccessfulDeploy', () => {
  it('skips deploys that failed or rolled back', () => {
    expect(
      latestSuccessfulDeploy([
        [
          {
            state: 'failure',
            environment_url: releaseUrl('0.2.2'),
            created_at: '2026-10-22T10:00:00Z',
          },
        ],
        [
          {
            state: 'success',
            environment_url: releaseUrl('0.2.1'),
            created_at: '2026-10-21T10:00:00Z',
          },
          { state: 'in_progress', created_at: '2026-10-21T09:58:00Z' },
        ],
      ])
    ).toEqual({ version: '0.2.1', deployedAt: '2026-10-21T10:00:00Z' });
  });

  it('only counts a deploy whose newest status is success', () => {
    expect(
      latestSuccessfulDeploy([
        [
          {
            state: 'failure',
            environment_url: releaseUrl('0.2.1'),
            created_at: '2026-10-21T10:05:00Z',
          },
          {
            state: 'success',
            environment_url: releaseUrl('0.2.1'),
            created_at: '2026-10-21T10:00:00Z',
          },
        ],
      ])
    ).toBeNull();
  });
});

describe('formatStationTable', () => {
  it('links each station to its history and its release', () => {
    const table = formatStationTable(
      [
        { station: PC1, version: '0.2.1', deployedAt: '2026-10-21T10:00:00Z' },
        {
          station: { ...PC1, name: 'pc2', environment: 'station-pc2' },
          version: null,
          deployedAt: null,
        },
      ],
      REPO
    ).split('\n');
    expect(table[2]).toBe(
      `| [pc1](https://github.com/${REPO}/deployments/station-pc1) | WIF room 104/105 | FastScanner | [v0.2.1](${releaseUrl('0.2.1')}) | 2026-10-21 |`
    );
    expect(table[3]).toContain('not deployed by the pipeline yet');
  });
});

describe('activeStations', () => {
  it('leaves out inactive stations', () => {
    const yaml = `stations:
  - name: pc1
    type: cylinderscan
    os: windows
    location: WIF room 104/105
    bloom_scanner_name: FastScanner
    environment: station-pc1
    runner_label: station-pc1
    active: true
  - name: old
    type: cylinderscan
    os: windows
    location: Store room
    bloom_scanner_name: OldScanner
    environment: station-old
    runner_label: station-old
    active: false
`;
    expect(activeStations(yaml).map((s) => s.name)).toEqual(['pc1']);
  });
});
