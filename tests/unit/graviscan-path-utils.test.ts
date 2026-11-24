// @vitest-environment node
/**
 * resolveGraviScanPath() with both naming styles: the earlier development
 * names (`00_cy1_<ms>.tiff`, kept for waves scanned before the rig names)
 * and the rig names. The page tracks a session plate by its planned name
 * (no `_et_`); the saved file has `_et_`, so the fallback must find it, and
 * must never pick another scanner's or another cycle's file.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveGraviScanPath } from '../../src/main/graviscan-path-utils';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-path-utils-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function touch(name: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, name);
  return p;
}

const PREFIX = 'Perceptome_Screen_wave20_st_20260809T190946';

describe('resolveGraviScanPath', () => {
  it('returns a rig-named file that exists as is', () => {
    const saved = touch(
      `${PREFIX}_et_20260809T191108_cy1_graviscan-desktop_Sc1_00.tif`
    );
    expect(resolveGraviScanPath(saved)).toBe(saved);
  });

  it('finds the saved file (with _et_) from the planned name (without _et_)', () => {
    const saved = touch(
      `${PREFIX}_et_20260809T191108_cy1_graviscan-desktop_Sc1_00.tif`
    );
    const planned = path.join(
      dir,
      `${PREFIX}_cy1_graviscan-desktop_Sc1_00.tif`
    );
    expect(resolveGraviScanPath(planned)).toBe(saved);
  });

  it("never returns another scanner's file at the same plate", () => {
    const sc1 = touch(
      `${PREFIX}_et_20260809T191108_cy1_graviscan-desktop_Sc1_00.tif`
    );
    const sc2 = touch(
      `${PREFIX}_et_20260809T191112_cy1_graviscan-desktop_Sc2_00.tif`
    );
    // Sc11 would only exist with 11+ scanners, but must not match Sc1.
    touch(`${PREFIX}_et_20260809T191113_cy1_graviscan-desktop_Sc11_00.tif`);

    expect(
      resolveGraviScanPath(
        path.join(dir, `${PREFIX}_cy1_graviscan-desktop_Sc1_00.tif`)
      )
    ).toBe(sc1);
    expect(
      resolveGraviScanPath(
        path.join(dir, `${PREFIX}_cy1_graviscan-desktop_Sc2_00.tif`)
      )
    ).toBe(sc2);
  });

  it("never returns another cycle's file", () => {
    touch(`${PREFIX}_et_20260809T191108_cy1_graviscan-desktop_Sc1_00.tif`);
    expect(
      resolveGraviScanPath(
        path.join(dir, `${PREFIX}_cy2_graviscan-desktop_Sc1_00.tif`)
      )
    ).toBeNull();
  });

  it('returns an earlier development name (00_cy1_<ms>.tiff) as is', () => {
    const old = touch('00_cy1_1763600000000.tiff');
    expect(resolveGraviScanPath(old)).toBe(old);
  });

  it('finds an earlier development file saved as .tif when the row says .tiff', () => {
    const saved = touch('01_cy1_1763600000000.tif');
    expect(
      resolveGraviScanPath(path.join(dir, '01_cy1_1763600000000.tiff'))
    ).toBe(saved);
  });

  it('returns null when nothing matches', () => {
    expect(
      resolveGraviScanPath(path.join(dir, '00_cy1_1763600000000.tiff'))
    ).toBeNull();
  });
});
