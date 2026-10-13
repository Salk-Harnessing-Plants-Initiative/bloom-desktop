/**
 * Validation for deploy/stations.yaml, the registry of deployment stations.
 *
 * The file is in a public repository, so validation also rejects unknown
 * fields, credential-like field names, and values containing IP addresses.
 *
 * CLI: `ts-node scripts/release/stations.ts [path]` (default
 * deploy/stations.yaml) prints each problem and exits non-zero if any.
 */

import * as fs from 'fs';
import * as path from 'path';
import { load } from 'js-yaml';

export const STATION_TYPES = ['cylinderscan', 'graviscan'] as const;
export const STATION_OS = ['windows', 'linux'] as const;

// Each scanner type currently ships for one OS only.
const OS_FOR_TYPE: Record<(typeof STATION_TYPES)[number], string> = {
  cylinderscan: 'windows',
  graviscan: 'linux',
};

const STRING_FIELDS = [
  'name',
  'type',
  'os',
  'location',
  'bloom_scanner_name',
  'environment',
  'runner_label',
] as const;
const KNOWN_FIELDS = new Set<string>([...STRING_FIELDS, 'active']);
const UNIQUE_FIELDS = ['name', 'environment', 'runner_label'] as const;
const SLUG_FIELDS = ['name', 'environment', 'runner_label'] as const;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SENSITIVE_FIELD_PATTERN =
  /(^ip$|_ip$|^ip_|address|password|token|key|secret)/i;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

const DEFAULT_STATIONS_PATH = path.join(
  __dirname,
  '..',
  '..',
  'deploy',
  'stations.yaml'
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateStation(
  station: Record<string, unknown>,
  index: number
): string[] {
  const label =
    typeof station.name === 'string' && station.name.trim()
      ? station.name
      : `stations[${index}]`;
  const errors: string[] = [];

  for (const [field, value] of Object.entries(station)) {
    if (!KNOWN_FIELDS.has(field)) {
      errors.push(
        SENSITIVE_FIELD_PATTERN.test(field)
          ? `${label}: "${field}" looks like a credential or address`
          : `${label}: unknown field "${field}"`
      );
    }
    if (typeof value === 'string' && IPV4_PATTERN.test(value)) {
      errors.push(`${label}: "${field}" contains an IP address`);
    }
  }

  for (const field of STRING_FIELDS) {
    const value = station[field];
    if (value === undefined) {
      errors.push(`${label}: missing "${field}"`);
    } else if (typeof value !== 'string' || !value.trim()) {
      errors.push(`${label}: "${field}" must be a non-empty string`);
    }
  }

  if (station.active === undefined) {
    errors.push(`${label}: missing "active"`);
  } else if (typeof station.active !== 'boolean') {
    errors.push(`${label}: "active" must be true or false`);
  }

  for (const field of SLUG_FIELDS) {
    const value = station[field];
    if (
      typeof value === 'string' &&
      value.trim() &&
      !SLUG_PATTERN.test(value)
    ) {
      errors.push(
        `${label}: "${field}" must be lowercase letters, digits and dashes`
      );
    }
  }

  const type = station.type as (typeof STATION_TYPES)[number];
  if (typeof station.type === 'string' && !STATION_TYPES.includes(type)) {
    errors.push(`${label}: "type" must be one of ${STATION_TYPES.join(', ')}`);
  }
  if (
    typeof station.os === 'string' &&
    !(STATION_OS as readonly string[]).includes(station.os)
  ) {
    errors.push(`${label}: "os" must be one of ${STATION_OS.join(', ')}`);
  }
  if (
    STATION_TYPES.includes(type) &&
    (STATION_OS as readonly unknown[]).includes(station.os) &&
    station.os !== OS_FOR_TYPE[type]
  ) {
    errors.push(`${label}: ${type} stations must run ${OS_FOR_TYPE[type]}`);
  }

  return errors;
}

/** Return every problem in a parsed stations document (empty if valid). */
export function validateStations(doc: unknown): string[] {
  if (!isRecord(doc) || !Array.isArray(doc.stations)) {
    return ['stations.yaml must contain a top-level "stations" list'];
  }

  const errors: string[] = [];
  const seen = new Map<string, Set<unknown>>(
    UNIQUE_FIELDS.map((f) => [f, new Set<unknown>()])
  );

  doc.stations.forEach((station: unknown, index: number) => {
    if (!isRecord(station)) {
      errors.push(`stations[${index}]: must be a mapping of fields`);
      return;
    }
    errors.push(...validateStation(station, index));

    for (const field of UNIQUE_FIELDS) {
      const value = station[field];
      if (value === undefined) continue;
      const values = seen.get(field) as Set<unknown>;
      if (values.has(value)) {
        errors.push(
          `${String(station.name)}: duplicate ${field} "${String(value)}"`
        );
      }
      values.add(value);
    }
  });

  return errors;
}

/** Parse and validate stations.yaml text; invalid YAML is reported, not thrown. */
export function validateStationsYaml(text: string): string[] {
  let doc: unknown;
  try {
    doc = load(text);
  } catch (error) {
    return [
      `Invalid YAML: ${error instanceof Error ? error.message : 'Unknown error'}`,
    ];
  }
  return validateStations(doc);
}

if (require.main === module) {
  const file = process.argv[2] ?? DEFAULT_STATIONS_PATH;
  try {
    const errors = validateStationsYaml(fs.readFileSync(file, 'utf8'));
    if (errors.length) {
      errors.forEach((e) => console.error(`[Stations] ${e}`));
      process.exit(1);
    }
    console.log(`[Stations] ${file} is valid`);
  } catch (error) {
    console.error(
      `[Stations] ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    process.exit(1);
  }
}
