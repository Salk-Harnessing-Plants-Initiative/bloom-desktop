/**
 * Plan step of the Deploy workflow: check the request before anything runs on a station.
 *
 * - the station is in deploy/stations.yaml, active, and a Windows CylinderScan station;
 * - the release `v<version>` is published (not a draft) and has its Windows installer
 *   files, manifest.json and SHA256SUMS.
 *
 * Outputs what the station job needs: its runner label, its GitHub environment, the
 * scanner name it must have, and the release download URL.
 *
 * CLI: `ts-node scripts/release/deploy-plan.ts --station <name> --version <v>
 *        --release-json <file> --repo <owner/name> [--github-output]`
 * where the release JSON is `gh release view <tag> --json tagName,isDraft,assets`.
 */
import * as fs from 'fs';
import * as path from 'path';
import { load } from 'js-yaml';
import { validateStationsYaml } from './stations';
import { parseRequestedVersion, releaseTag } from './release-version';
import { MANIFEST_FILE_NAME, SHA256SUMS_FILE_NAME } from './release-manifest';

export interface ReleaseInfo {
  tagName: string;
  isDraft: boolean;
  assets: { name: string }[];
}

export interface DeployPlan {
  station: string;
  version: string;
  tag: string;
  runnerLabel: string;
  environment: string;
  scannerName: string;
  releaseBaseUrl: string;
  /** The release page, linked from the station's deployment record. */
  releaseUrl: string;
}

interface StationEntry {
  name: string;
  type: string;
  os: string;
  bloom_scanner_name: string;
  environment: string;
  runner_label: string;
  active: boolean;
}

const REQUIRED_WINDOWS_ASSETS: {
  label: string;
  matches: (name: string) => boolean;
}[] = [
  { label: MANIFEST_FILE_NAME, matches: (n) => n === MANIFEST_FILE_NAME },
  { label: SHA256SUMS_FILE_NAME, matches: (n) => n === SHA256SUMS_FILE_NAME },
  { label: 'RELEASES', matches: (n) => n === 'RELEASES' },
  { label: 'the full .nupkg', matches: (n) => n.endsWith('-full.nupkg') },
  { label: 'Setup.exe', matches: (n) => n.toLowerCase().endsWith('.exe') },
];

export function planDeploy(input: {
  stationsYaml: string;
  station: string;
  version: string;
  release: ReleaseInfo;
  repo: string;
}): DeployPlan {
  const version = parseRequestedVersion(input.version);
  const tag = releaseTag(version);

  const problems = validateStationsYaml(input.stationsYaml);
  if (problems.length > 0) {
    throw new Error(
      `deploy/stations.yaml is invalid:\n- ${problems.join('\n- ')}`
    );
  }
  const stations = (load(input.stationsYaml) as { stations: StationEntry[] })
    .stations;
  const station = stations.find((s) => s.name === input.station);
  if (!station) {
    throw new Error(`No station "${input.station}" in deploy/stations.yaml.`);
  }
  if (!station.active) {
    throw new Error(
      `Station "${station.name}" is inactive in deploy/stations.yaml.`
    );
  }
  if (station.os !== 'windows' || station.type !== 'cylinderscan') {
    throw new Error(
      `Station "${station.name}" is ${station.type} on ${station.os}; only Windows CylinderScan stations can be deployed for now.`
    );
  }

  if (input.release.tagName !== tag) {
    throw new Error(
      `The release found is ${input.release.tagName}, not ${tag}.`
    );
  }
  if (input.release.isDraft) {
    throw new Error(
      `Release ${tag} is still a draft; publish it before deploying.`
    );
  }
  const names = input.release.assets.map((a) => a.name);
  const missing = REQUIRED_WINDOWS_ASSETS.filter(
    (r) => !names.some(r.matches)
  ).map((r) => r.label);
  if (missing.length > 0) {
    throw new Error(`Release ${tag} is missing ${missing.join(', ')}.`);
  }

  return {
    station: station.name,
    version,
    tag,
    runnerLabel: station.runner_label,
    environment: station.environment,
    scannerName: station.bloom_scanner_name,
    releaseBaseUrl: `https://github.com/${input.repo}/releases/download/${tag}`,
    releaseUrl: `https://github.com/${input.repo}/releases/tag/${tag}`,
  };
}

export function formatPlanOutput(plan: DeployPlan): string {
  return [
    `station=${plan.station}`,
    `version=${plan.version}`,
    `tag=${plan.tag}`,
    `runner_label=${plan.runnerLabel}`,
    `environment=${plan.environment}`,
    `scanner_name=${plan.scannerName}`,
    `release_base_url=${plan.releaseBaseUrl}`,
    `release_url=${plan.releaseUrl}`,
    '',
  ].join('\n');
}

function argValue(args: string[], flag: string): string {
  const i = args.indexOf(flag);
  if (i === -1 || !args[i + 1]) throw new Error(`Missing ${flag}`);
  return args[i + 1];
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const plan = planDeploy({
      stationsYaml: fs.readFileSync(
        path.join(__dirname, '..', '..', 'deploy', 'stations.yaml'),
        'utf8'
      ),
      station: argValue(args, '--station'),
      version: argValue(args, '--version'),
      release: JSON.parse(
        fs.readFileSync(argValue(args, '--release-json'), 'utf8')
      ) as ReleaseInfo,
      repo: argValue(args, '--repo'),
    });
    const output = formatPlanOutput(plan);
    process.stdout.write(output);
    if (args.includes('--github-output')) {
      const target = process.env.GITHUB_OUTPUT;
      if (!target) throw new Error('GITHUB_OUTPUT is not set');
      fs.appendFileSync(target, output);
    }
  } catch (error) {
    console.error(
      `::error::${error instanceof Error ? error.message : 'Unknown error'}`
    );
    process.exit(1);
  }
}
