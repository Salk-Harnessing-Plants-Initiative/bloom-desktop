/**
 * Which station has which version: for every active station in deploy/stations.yaml,
 * the newest successful deploy recorded in its GitHub environment. Each deploy links
 * its environment to the release page (deploy.yml), so the version is read from that
 * link. Printed as a Markdown table for the Station versions workflow's job summary.
 *
 * Only deploys made by the Deploy workflow are known; a manual install isn't recorded.
 *
 * CLI: `ts-node scripts/release/station-versions.ts --repo <owner/name>` with
 *      GITHUB_TOKEN set (needs `deployments: read`).
 */
import * as fs from 'fs';
import * as path from 'path';
import { load } from 'js-yaml';
import { validateStationsYaml } from './stations';

const GITHUB_API = 'https://api.github.com';
/** Deploys per station looked at, newest first; failed ones are skipped. */
const DEPLOYMENTS_PER_STATION = 30;

export interface StationLike {
  name: string;
  location: string;
  bloom_scanner_name: string;
  environment: string;
  active: boolean;
}

export interface DeploymentStatusLike {
  state: string;
  environment_url?: string;
  created_at: string;
}

export interface StationVersion {
  station: StationLike;
  version: string | null;
  deployedAt: string | null;
}

/** `https://github.com/o/r/releases/tag/v0.2.1` → `0.2.1` (pre-releases like `0.2.1-rc.1` too). */
export function versionFromReleaseUrl(url: string | undefined): string | null {
  const match = url?.match(
    /\/releases\/tag\/v(\d+\.\d+\.\d+(?:-[A-Za-z]+\.\d+)?)$/
  );
  return match ? match[1] : null;
}

/**
 * The newest successful deploy, given each deploy's statuses (newest deploy first,
 * each deploy's statuses newest first, as GitHub returns them).
 */
export function latestSuccessfulDeploy(
  statusesPerDeploy: DeploymentStatusLike[][]
): { version: string; deployedAt: string } | null {
  for (const statuses of statusesPerDeploy) {
    const latest = statuses[0];
    if (latest?.state !== 'success') continue;
    const version = versionFromReleaseUrl(latest.environment_url);
    if (version) return { version, deployedAt: latest.created_at };
  }
  return null;
}

export function formatStationTable(
  rows: StationVersion[],
  repo: string
): string {
  const lines = [
    '| Station | Location | Scanner | Version | Deployed |',
    '|---|---|---|---|---|',
  ];
  for (const { station, version, deployedAt } of rows) {
    const history = `https://github.com/${repo}/deployments/${station.environment}`;
    const versionCell = version
      ? `[v${version}](https://github.com/${repo}/releases/tag/v${version})`
      : 'not deployed by the pipeline yet';
    lines.push(
      `| [${station.name}](${history}) | ${station.location} | ${station.bloom_scanner_name} | ${versionCell} | ${deployedAt ? deployedAt.slice(0, 10) : '–'} |`
    );
  }
  return lines.join('\n');
}

export function activeStations(stationsYaml: string): StationLike[] {
  const problems = validateStationsYaml(stationsYaml);
  if (problems.length > 0) {
    throw new Error(
      `deploy/stations.yaml is invalid:\n- ${problems.join('\n- ')}`
    );
  }
  const doc = load(stationsYaml) as { stations: StationLike[] };
  return doc.stations.filter((s) => s.active);
}

async function githubGet<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${url}`);
  }
  return (await response.json()) as T;
}

async function stationVersion(
  station: StationLike,
  repo: string,
  token: string
): Promise<StationVersion> {
  const deployments = await githubGet<{ statuses_url: string }[]>(
    `${GITHUB_API}/repos/${repo}/deployments?environment=${encodeURIComponent(station.environment)}&per_page=${DEPLOYMENTS_PER_STATION}`,
    token
  );
  const statuses = await Promise.all(
    deployments.map((d) =>
      githubGet<DeploymentStatusLike[]>(d.statuses_url, token)
    )
  );
  const latest = latestSuccessfulDeploy(statuses);
  return {
    station,
    version: latest?.version ?? null,
    deployedAt: latest?.deployedAt ?? null,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const repo = args[args.indexOf('--repo') + 1];
  const token = process.env.GITHUB_TOKEN;
  if (!repo || args.indexOf('--repo') === -1)
    throw new Error('--repo is required');
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  const yaml = fs.readFileSync(
    path.join(__dirname, '..', '..', 'deploy', 'stations.yaml'),
    'utf8'
  );
  const rows = await Promise.all(
    activeStations(yaml).map((s) => stationVersion(s, repo, token))
  );
  console.log(formatStationTable(rows, repo));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      `[StationVersions] ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    process.exit(1);
  });
}
