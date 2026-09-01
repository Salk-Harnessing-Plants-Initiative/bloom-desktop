/**
 * Pure (platform) -> staged-executable-name resolver for forge.config.ts's
 * packagerConfig.executableName.
 *
 * Extracted as its own parameterized function (rather than an inline
 * process.platform ternary in forge.config.ts) so the platform-dependent
 * naming logic stays unit-testable without mocking module-load-time
 * globals — matching resolveStagedAppPath's existing pattern.
 */

const PRODUCT_NAME = 'Bloom Desktop';

export function resolveExecutableName(platform: NodeJS.Platform): string {
  return platform === 'linux' ? 'bloom-desktop' : PRODUCT_NAME;
}
