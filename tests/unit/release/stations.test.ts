/**
 * Unit tests for deploy/stations.yaml validation. The registry is public, so
 * validation also rejects anything that looks like an IP address or credential.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  validateStations,
  validateStationsYaml,
} from '../../../scripts/release/stations';

function station(overrides: Record<string, unknown> = {}) {
  return {
    name: 'pc1',
    type: 'cylinderscan',
    os: 'windows',
    location: 'Greenhouse bench 1',
    bloom_scanner_name: 'PBIOBScanner',
    environment: 'station-pc1',
    runner_label: 'station-pc1',
    active: true,
    ...overrides,
  };
}

describe('validateStations', () => {
  it('accepts a valid station', () => {
    expect(validateStations({ stations: [station()] })).toEqual([]);
  });

  it('accepts an empty list', () => {
    expect(validateStations({ stations: [] })).toEqual([]);
  });

  it('accepts a graviscan station on linux', () => {
    expect(
      validateStations({
        stations: [station({ type: 'graviscan', os: 'linux' })],
      })
    ).toEqual([]);
  });

  it.each([null, 'stations', [], {}])(
    'rejects a document without a stations list (%j)',
    (doc) => {
      expect(validateStations(doc)).toEqual([
        'stations.yaml must contain a top-level "stations" list',
      ]);
    }
  );

  it('rejects a station that is not a mapping', () => {
    expect(validateStations({ stations: ['pc1'] })).toEqual([
      'stations[0]: must be a mapping of fields',
    ]);
  });

  it.each([
    'name',
    'type',
    'os',
    'location',
    'bloom_scanner_name',
    'environment',
    'runner_label',
    'active',
  ])('reports a missing %s with the station name', (field) => {
    const s: Record<string, unknown> = station();
    delete s[field];
    const label = field === 'name' ? 'stations[0]' : 'pc1';
    expect(validateStations({ stations: [s] })).toContain(
      `${label}: missing "${field}"`
    );
  });

  it('rejects an empty string field', () => {
    expect(
      validateStations({ stations: [station({ location: '  ' })] })
    ).toContain('pc1: "location" must be a non-empty string');
  });

  it('rejects a non-boolean active', () => {
    expect(
      validateStations({ stations: [station({ active: 'yes' })] })
    ).toContain('pc1: "active" must be true or false');
  });

  it.each(['type', 'os'])('rejects an unknown %s', (field) => {
    const errors = validateStations({
      stations: [station({ [field]: 'macos' })],
    });
    expect(
      errors.some((e) => e.startsWith(`pc1: "${field}" must be one of`))
    ).toBe(true);
  });

  it.each([
    ['cylinderscan', 'linux'],
    ['graviscan', 'windows'],
  ])('rejects type %s on os %s', (type, os) => {
    expect(validateStations({ stations: [station({ type, os })] })).toContain(
      `pc1: ${type} stations must run ${type === 'cylinderscan' ? 'windows' : 'linux'}`
    );
  });

  it.each(['PC1', 'pc 1', '-pc1', 'pc_1'])(
    'rejects name %j that is not lowercase [a-z0-9-]',
    (name) => {
      expect(
        validateStations({ stations: [station({ name })] }).some((e) =>
          e.includes('"name" must be lowercase letters, digits and dashes')
        )
      ).toBe(true);
    }
  );

  it.each(['name', 'environment', 'runner_label'])(
    'rejects a duplicate %s',
    (field) => {
      const a = station();
      const b = station({
        name: 'pc2',
        environment: 'station-pc2',
        runner_label: 'station-pc2',
        [field]: a[field as keyof typeof a],
      });
      expect(validateStations({ stations: [a, b] })).toContain(
        `${b.name}: duplicate ${field} "${a[field as keyof typeof a]}"`
      );
    }
  );

  it('rejects unknown fields so new data is added deliberately', () => {
    expect(
      validateStations({ stations: [station({ notes: 'hi' })] })
    ).toContain('pc1: unknown field "notes"');
  });

  it.each(['ip', 'password', 'api_token', 'anon_key', 'client_secret'])(
    'rejects a credential-like field %s',
    (field) => {
      expect(
        validateStations({ stations: [station({ [field]: 'x' })] })
      ).toContain(`pc1: "${field}" looks like a credential or address`);
    }
  );

  it.each(['10.0.0.23', 'Bench near 192.168.1.50'])(
    'rejects a value containing an IP address (%s)',
    (value) => {
      expect(
        validateStations({ stations: [station({ location: value })] })
      ).toContain('pc1: "location" contains an IP address');
    }
  );

  it('reports every problem, not just the first', () => {
    const errors = validateStations({
      stations: [station({ type: 'x', os: 'y', active: 1 })],
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('validateStationsYaml', () => {
  it('parses and validates YAML text', () => {
    const text = [
      'stations:',
      '  - name: pc1',
      '    type: cylinderscan',
      '    os: windows',
      '    location: Greenhouse bench 1',
      '    bloom_scanner_name: PBIOBScanner',
      '    environment: station-pc1',
      '    runner_label: station-pc1',
      '    active: true',
    ].join('\n');
    expect(validateStationsYaml(text)).toEqual([]);
  });

  it('reports invalid YAML instead of throwing', () => {
    const errors = validateStationsYaml('stations: [unclosed');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^Invalid YAML:/);
  });

  it('accepts the checked-in deploy/stations.yaml', () => {
    const file = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'deploy',
      'stations.yaml'
    );
    expect(validateStationsYaml(fs.readFileSync(file, 'utf8'))).toEqual([]);
  });
});
