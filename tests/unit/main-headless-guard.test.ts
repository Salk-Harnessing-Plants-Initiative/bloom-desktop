/**
 * main.ts can't be imported in a unit test (it starts Electron), so this reads its
 * source: the headless runs (the deploy self-test and the start-date backfill) must
 * never start the normal app, so every `ready` and `activate` handler begins with the
 * headless check, and the check covers both flags.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const source = fs.readFileSync(
  path.join(__dirname, '../../src/main/main.ts'),
  'utf-8'
);

describe('main.ts headless runs', () => {
  it('treats the deploy self-test and the start-date backfill as headless', () => {
    expect(source).toMatch(
      /const isHeadlessRun = \(\): boolean =>\s*deploySelfTest !== null \|\| sowingDateBackfill !== null;/
    );
  });

  it('starts every ready and activate handler with the headless check', () => {
    const handlers = [
      ...source.matchAll(
        /app\.on\('(ready|activate)', (?:async )?\(\) => \{\s*([^\n]*)/g
      ),
    ];
    expect(handlers.map((h) => h[1]).sort()).toEqual(['activate', 'ready']);
    for (const [, , firstLine] of handlers) {
      expect(firstLine.trim()).toBe('if (isHeadlessRun()) return;');
    }
  });
});
