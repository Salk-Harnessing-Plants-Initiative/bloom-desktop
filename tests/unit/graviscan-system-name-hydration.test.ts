// @vitest-environment node
/**
 * GRAVISCAN_SYSTEM_NAME startup hydration logic
 * (production parity gap #6 — see
 * openspec/changes/add-graviscan-system-name-config)
 *
 * These tests verify the logic that IS implemented in
 * src/main/main.ts's startup `try` block (~line 1165-1185, immediately
 * after the LIBUSB_ENDPOINT_RECOVERY hydration, reusing the same
 * `config` object already returned by `loadEnvConfig(ENV_PATH)`).
 *
 * `main.ts` itself is not directly unit-testable here: it imports
 * `electron` (`app`, `BrowserWindow`, `ipcMain`, `dialog`) and has
 * side effects at module-load time, so no existing test in this repo
 * imports it — including for the precedent
 * `slack_webhook_url`/`libusb_endpoint_recovery` hydration blocks it
 * already contains. This file follows the same "logic that will be
 * implemented in main.ts" approach already used by
 * `tests/unit/scanner-identity.test.ts` for `scanner_name`: the
 * assertions below exercise a verbatim copy of the hydration branch,
 * kept in sync with `main.ts` by inspection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/** Minimal shape of the fields main.ts's hydration block reads. */
interface HydrationConfig {
  graviscan_system_name?: string;
}

/**
 * Mirrors src/main/main.ts's GRAVISCAN_SYSTEM_NAME hydration block
 * verbatim (same condition, same env var, same log-line intent).
 */
function hydrateGraviscanSystemName(config: HydrationConfig): void {
  if (config.graviscan_system_name) {
    process.env.GRAVISCAN_SYSTEM_NAME = config.graviscan_system_name;
    console.log(
      `[GraviScan] GRAVISCAN_SYSTEM_NAME loaded from ~/.bloom/.env: ${config.graviscan_system_name}`
    );
  } else {
    console.log(
      '[GraviScan] GRAVISCAN_SYSTEM_NAME not set — uploads/Box backup will omit system-name attribution'
    );
  }
}

describe('main.ts startup hydration: GRAVISCAN_SYSTEM_NAME', () => {
  const original = process.env.GRAVISCAN_SYSTEM_NAME;

  beforeEach(() => {
    delete process.env.GRAVISCAN_SYSTEM_NAME;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.GRAVISCAN_SYSTEM_NAME;
    } else {
      process.env.GRAVISCAN_SYSTEM_NAME = original;
    }
    vi.restoreAllMocks();
  });

  it('sets process.env.GRAVISCAN_SYSTEM_NAME when config carries a non-empty value', () => {
    hydrateGraviscanSystemName({ graviscan_system_name: 'pbiob-gh-04' });

    expect(process.env.GRAVISCAN_SYSTEM_NAME).toBe('pbiob-gh-04');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('GRAVISCAN_SYSTEM_NAME loaded')
    );
  });

  it('does NOT set process.env.GRAVISCAN_SYSTEM_NAME when config omits it (undefined)', () => {
    hydrateGraviscanSystemName({ graviscan_system_name: undefined });

    expect(process.env.GRAVISCAN_SYSTEM_NAME).toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('GRAVISCAN_SYSTEM_NAME not set')
    );
  });

  it('does NOT set process.env.GRAVISCAN_SYSTEM_NAME when config has an empty string', () => {
    hydrateGraviscanSystemName({ graviscan_system_name: '' });

    expect(process.env.GRAVISCAN_SYSTEM_NAME).toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('GRAVISCAN_SYSTEM_NAME not set')
    );
  });
});
