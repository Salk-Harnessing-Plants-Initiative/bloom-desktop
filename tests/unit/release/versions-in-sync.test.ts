/**
 * The app version lives in package.json, but the Python package carries its
 * own copy, which GraviScan writes into every TIFF as `bloom_version`. A
 * release bump that misses one would stamp scans with the wrong version, so
 * all copies must match.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');

function read(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function match(file: string, pattern: RegExp): string {
  const found = pattern.exec(read(file));
  if (!found) throw new Error(`no version found in ${file}`);
  return found[1];
}

const appVersion = (JSON.parse(read('package.json')) as { version: string })
  .version;

describe('version numbers stay in sync with package.json', () => {
  it.each([
    ['package-lock.json', /^ {2}"version": "([^"]+)"/m],
    ['pyproject.toml', /^version = "([^"]+)"/m],
    ['uv.lock', /name = "bloom-hardware"\nversion = "([^"]+)"/],
    ['python/__init__.py', /^__version__ = "([^"]+)"/m],
  ])('%s', (file, pattern) => {
    expect(match(file, pattern)).toBe(appVersion);
  });
});
