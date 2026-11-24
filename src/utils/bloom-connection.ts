/**
 * Whether this computer uses Bloom. Bloom is on unless the machine config has
 * BLOOM_NOT_CONNECTED=true. No Node imports, so pages can use it too.
 */
export function isBloomConnected(config: {
  bloom_not_connected?: boolean;
}): boolean {
  return config.bloom_not_connected !== true;
}
