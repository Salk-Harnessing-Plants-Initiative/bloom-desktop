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

describe('validateStations: nothing private can be published', () => {
  it.each([
    ['IPv6 address', 'fe80::1ff:fe23:4567:890a', 'contains an IP address'],
    [
      'full IPv6 address',
      '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      'contains an IP address',
    ],
    [
      'URL with a password',
      'https://admin:hunter2@scanner.local',
      'contains a URL with credentials',
    ],
  ])('rejects a station value holding a %s', (_label, value, message) => {
    expect(
      validateStations({
        stations: [station({ bloom_scanner_name: value })],
      })
    ).toContain(`pc1: "bloom_scanner_name" ${message}`);
  });

  it.each([
    'Greenhouse 2, bench 3.1',
    'Room 10:30 slot',
    'PBIOBScanner',
    'https://bloom.salk.edu/api',
  ])('does not flag the ordinary value %j', (value) => {
    expect(
      validateStations({ stations: [station({ location: value })] })
    ).toEqual([]);
  });

  it('rejects a credential-like top-level key', () => {
    expect(validateStations({ password: 'hunter2', stations: [] })).toContain(
      'top-level "password" looks like a credential or address'
    );
  });

  it('rejects an IP stored under a top-level key', () => {
    expect(validateStations({ camera_ip: '10.0.0.5', stations: [] })).toEqual([
      'top-level "camera_ip" looks like a credential or address',
      'top-level "camera_ip" contains an IP address',
    ]);
  });

  it('rejects any other top-level key', () => {
    expect(validateStations({ notes: 'hi', stations: [] })).toEqual([
      'unknown top-level key "notes"',
    ]);
  });

  it('finds an IP nested deep inside a top-level value', () => {
    expect(
      validateStations({
        defaults: { network: ['ok', { camera: '192.168.1.50' }] },
        stations: [],
      })
    ).toContain('top-level "defaults" contains an IP address');
  });

  it('finds an IP nested inside an unknown station field', () => {
    expect(
      validateStations({
        stations: [station({ extra: { host: '10.0.0.9' } })],
      })
    ).toContain('pc1: "extra" contains an IP address');
  });

  it('still requires the stations list when other keys are present', () => {
    expect(validateStations({ password: 'x' })).toEqual([
      'stations.yaml must contain a top-level "stations" list',
    ]);
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

  it('rejects the reviewed example: IP and password beside stations', () => {
    const text = 'camera_ip: 10.0.0.5\npassword: hunter2\nstations: []\n';
    const errors = validateStationsYaml(text);
    expect(errors).toContain('top-level "camera_ip" contains an IP address');
    expect(errors).toContain(
      'top-level "password" looks like a credential or address'
    );
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
