/**
 * Unit tests for resolveExecutableName(), a pure (platform) -> executable-name
 * function used by forge.config.ts's packagerConfig.executableName.
 */

import { describe, it, expect } from 'vitest';
import { resolveExecutableName } from '../../scripts/resolve-executable-name';

describe('resolveExecutableName', () => {
  it('returns the sanitized, no-space name for linux', () => {
    expect(resolveExecutableName('linux')).toBe('bloom-desktop');
  });

  it('returns the product name for darwin', () => {
    expect(resolveExecutableName('darwin')).toBe('Bloom Desktop');
  });

  it('returns the product name for win32', () => {
    expect(resolveExecutableName('win32')).toBe('Bloom Desktop');
  });
});
