import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Spec invariant guard: no GraviScan renderer or main-process site may resolve
 * assignment ↔ detected by matching `scanner_id` to `scannerId`. The empty-
 * string sentinel `''` shared by fresh-install placeholder scanners makes such
 * matches collide via Array.find (N→1 collapse on Save).
 *
 * See openspec/changes/fix-renderer-empty-scanner-id-collision/specs/scanning/
 * spec.md ("Lookup-key invariant for assignment ↔ detected resolution").
 *
 * Implementation note: this test walks the file tree with Node's `fs` module
 * rather than shelling out to `grep`/`rg`. That makes it portable to
 * Linux/macOS/Windows CI (no `/bin/sh` dependency) AND lets us match patterns
 * a regex applied per-line in `grep` would silently miss (whitespace
 * variations, negated comparisons, multi-line forms).
 */

const SCAN_DIRS = ['src/renderer', 'src/main/graviscan'] as const;
const FILE_EXTENSIONS = /\.(ts|tsx)$/;

// Match BOTH `===` and `!==` (negated forms are equally collision-prone — the
// boolean inverts but both sides still compare placeholder `''` to placeholder
// `''`). Allow zero or more whitespace around the operator (the original regex
// required exactly one space, missing `s.scanner_id===a.scannerId`). The
// `\S+\.` ensures we capture a property access on either side, not a bare
// literal.
const COLLISION_PATTERN =
  /\.scanner_id\s*(?:===|!==)\s*\S+\.scannerId|\.scannerId\s*(?:===|!==)\s*\S+\.scanner_id/;

function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // missing dir is fine
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...walkSourceFiles(path));
    } else if (FILE_EXTENSIONS.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

describe('Spec invariant: no scanner_id↔scannerId collision pattern', () => {
  it('no Array.find / .findIndex / .some on scanner_id ↔ scannerId pairs (renderer + main/graviscan)', () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walkSourceFiles(dir)) {
        const lines = readFileSync(file, 'utf8').split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (COLLISION_PATTERN.test(lines[i])) {
            offenders.push(`${file}:${i + 1}: ${lines[i].trim()}`);
          }
        }
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `Found ${offenders.length} collision-prone scanner_id/scannerId comparisons:\n${offenders.join('\n')}\n\n` +
          `Use findDetectedForAssignment / findIndexDetectedForAssignment / ` +
          `findAssignmentForDetected from src/types/graviscan.ts. See ` +
          `openspec/changes/fix-renderer-empty-scanner-id-collision/proposal.md.`
      );
    }
    expect(offenders).toEqual([]);
  });
});
