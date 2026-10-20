import { describe, it, expect } from 'vitest';
import {
  planDeploy,
  formatPlanOutput,
  type ReleaseInfo,
} from '../../../scripts/release/deploy-plan';

const REPO = 'Salk-Harnessing-Plants-Initiative/bloom-desktop';

const stationsYaml = (station: Record<string, unknown> = {}) =>
  [
    'stations:',
    '  - name: pc1',
    `    type: ${station.type ?? 'cylinderscan'}`,
    `    os: ${station.os ?? 'windows'}`,
    '    location: WIF room 104/105',
    '    bloom_scanner_name: PC1Scanner',
    '    environment: station-pc1',
    '    runner_label: station-pc1',
    `    active: ${station.active ?? true}`,
    '',
  ].join('\n');

const release = (overrides: Partial<ReleaseInfo> = {}): ReleaseInfo => ({
  tagName: 'v0.2.0',
  isDraft: false,
  assets: [
    { name: 'Bloom.Desktop-0.2.0.Setup.exe' },
    { name: 'bloom_desktop-0.2.0-full.nupkg' },
    { name: 'RELEASES' },
    { name: 'bloom-desktop_0.2.0_amd64.deb' },
    { name: 'manifest.json' },
    { name: 'SHA256SUMS' },
  ],
  ...overrides,
});

describe('planDeploy', () => {
  it('plans a pre-release the Windows installer can name', () => {
    const plan = planDeploy({
      stationsYaml: stationsYaml(),
      station: 'pc1',
      version: '0.2.1-rc.1',
      release: release({ tagName: 'v0.2.1-rc.1' }),
      repo: REPO,
    });
    expect(plan.tag).toBe('v0.2.1-rc.1');
    expect(plan.releaseBaseUrl).toBe(
      `https://github.com/${REPO}/releases/download/v0.2.1-rc.1`
    );
  });

  it.each(['0.2.1-rc.10', '0.2.1-rc', '0.2.1-beta.1.2', '0.2.1-rc.0'])(
    'refuses %s, which a station could not map back from its install folder',
    (version) => {
      expect(() =>
        planDeploy({
          stationsYaml: stationsYaml(),
          station: 'pc1',
          version,
          release: release({ tagName: `v${version}` }),
          repo: REPO,
        })
      ).toThrow(/can't be deployed/);
    }
  );

  it('plans a deploy of a published release to an active Windows station', () => {
    expect(
      planDeploy({
        stationsYaml: stationsYaml(),
        station: 'pc1',
        version: 'v0.2.0',
        release: release(),
        repo: REPO,
      })
    ).toEqual({
      station: 'pc1',
      version: '0.2.0',
      tag: 'v0.2.0',
      runnerLabel: 'station-pc1',
      environment: 'station-pc1',
      scannerName: 'PC1Scanner',
      releaseBaseUrl: `https://github.com/${REPO}/releases/download/v0.2.0`,
      releaseUrl: `https://github.com/${REPO}/releases/tag/v0.2.0`,
    });
  });

  it('refuses an unknown station', () => {
    expect(() =>
      planDeploy({
        stationsYaml: stationsYaml(),
        station: 'pc9',
        version: '0.2.0',
        release: release(),
        repo: REPO,
      })
    ).toThrow(/No station "pc9"/);
  });

  it('refuses an inactive station', () => {
    expect(() =>
      planDeploy({
        stationsYaml: stationsYaml({ active: false }),
        station: 'pc1',
        version: '0.2.0',
        release: release(),
        repo: REPO,
      })
    ).toThrow(/inactive/);
  });

  it('refuses a GraviScan (Linux) station for now', () => {
    expect(() =>
      planDeploy({
        stationsYaml: stationsYaml({ type: 'graviscan', os: 'linux' }),
        station: 'pc1',
        version: '0.2.0',
        release: release(),
        repo: REPO,
      })
    ).toThrow(/Windows CylinderScan/);
  });

  it('refuses an invalid stations.yaml', () => {
    expect(() =>
      planDeploy({
        stationsYaml: 'stations: nope',
        station: 'pc1',
        version: '0.2.0',
        release: release(),
        repo: REPO,
      })
    ).toThrow(/stations\.yaml/);
  });

  it('refuses a draft release', () => {
    expect(() =>
      planDeploy({
        stationsYaml: stationsYaml(),
        station: 'pc1',
        version: '0.2.0',
        release: release({ isDraft: true }),
        repo: REPO,
      })
    ).toThrow(/draft/);
  });

  it('refuses a release for another version', () => {
    expect(() =>
      planDeploy({
        stationsYaml: stationsYaml(),
        station: 'pc1',
        version: '0.3.0',
        release: release(),
        repo: REPO,
      })
    ).toThrow(/v0\.2\.0.*v0\.3\.0|v0\.3\.0.*v0\.2\.0/);
  });

  it.each(['manifest.json', 'SHA256SUMS', 'RELEASES'])(
    'refuses a release missing %s',
    (name) => {
      const assets = release().assets.filter((a) => a.name !== name);
      expect(() =>
        planDeploy({
          stationsYaml: stationsYaml(),
          station: 'pc1',
          version: '0.2.0',
          release: release({ assets }),
          repo: REPO,
        })
      ).toThrow(new RegExp(name));
    }
  );

  it('refuses a release with no Setup.exe', () => {
    const assets = release().assets.filter((a) => !a.name.endsWith('.exe'));
    expect(() =>
      planDeploy({
        stationsYaml: stationsYaml(),
        station: 'pc1',
        version: '0.2.0',
        release: release({ assets }),
        repo: REPO,
      })
    ).toThrow(/Setup\.exe/);
  });

  it('refuses a version that is not a release version', () => {
    expect(() =>
      planDeploy({
        stationsYaml: stationsYaml(),
        station: 'pc1',
        version: 'latest',
        release: release(),
        repo: REPO,
      })
    ).toThrow(/not a release version/);
  });
});

describe('formatPlanOutput', () => {
  it('writes key=value lines for $GITHUB_OUTPUT', () => {
    const plan = planDeploy({
      stationsYaml: stationsYaml(),
      station: 'pc1',
      version: '0.2.0',
      release: release(),
      repo: REPO,
    });
    expect(formatPlanOutput(plan).split('\n')).toEqual([
      'station=pc1',
      'version=0.2.0',
      'tag=v0.2.0',
      'runner_label=station-pc1',
      'environment=station-pc1',
      'scanner_name=PC1Scanner',
      `release_base_url=https://github.com/${REPO}/releases/download/v0.2.0`,
      `release_url=https://github.com/${REPO}/releases/tag/v0.2.0`,
      '',
    ]);
  });
});
