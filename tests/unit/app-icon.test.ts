/**
 * App icon and Windows name settings used by forge.config.ts.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  APP_ICON_BASE,
  WINDOWS_ICON,
  LINUX_ICON,
  windowsMetadata,
} from '../../scripts/app-icon';
import { PRODUCT_NAME } from '../../scripts/product-name';

const root = path.join(__dirname, '..', '..');

describe('app icon files', () => {
  it.each(['.ico', '.icns', '.png', '.svg'])('icon%s exists', (ext) => {
    expect(fs.existsSync(path.join(root, `${APP_ICON_BASE}${ext}`))).toBe(true);
  });

  it('the Windows icon includes the largest size Windows uses (256 px)', () => {
    // ICO header: count at byte 4; each 16-byte entry stores width at byte 0 (0 means 256).
    const ico = fs.readFileSync(path.join(root, WINDOWS_ICON));
    const count = ico.readUInt16LE(4);
    const widths = Array.from(
      { length: count },
      (_, i) => ico[6 + i * 16] || 256
    );
    expect(widths).toEqual(expect.arrayContaining([16, 32, 48, 256]));
  });

  it('the Linux icon is the PNG', () => {
    expect(LINUX_ICON).toBe(`${APP_ICON_BASE}.png`);
  });
});

describe('windowsMetadata', () => {
  it('names the program "Bloom Desktop" wherever Windows shows it', () => {
    expect(PRODUCT_NAME).toBe('Bloom Desktop');
    expect(windowsMetadata(PRODUCT_NAME)).toEqual({
      ProductName: 'Bloom Desktop',
      FileDescription: 'Bloom Desktop',
    });
  });
});
