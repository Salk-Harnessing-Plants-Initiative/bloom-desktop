# Proposal: Add Scanner Name Validation via Bloom API

## Problem Statement

Currently, the Machine Configuration page allows users to enter any text for the scanner name field. However, the Bloom cloud database has a `scanners` table with a predefined list of valid scanner names (e.g., "FastScanner", "SlowScanner", "PBIOBScanner", "Unknown"). When scan data is synced to the cloud, invalid scanner names will cause foreign key constraint failures.

## Proposed Solution

Fetch the list of valid scanner names from the Bloom API and present them as a dropdown selector in the Machine Configuration page. This ensures data integrity by preventing users from entering scanner names that don't exist in the cloud database.

## Scope

### MODIFIED Capabilities

- **machine-configuration**: Add scanner name dropdown populated from Bloom API
  - Replace free-text input with dropdown selector
  - Fetch valid scanner names from Bloom API on page load
  - Require API connection to configure scanner name (no offline fallback)
  - Show loading state while fetching scanner list
  - Show error state if API fetch fails

### Dependencies

- Requires Bloom API credentials to be configured (existing)
- Requires `bloom_api_url` to be set (existing)
- Read-only access to Bloom API `/scanners` endpoint

## Design Decisions

1. **API-fetched list**: Valid scanner names are fetched from Bloom API rather than hardcoded, ensuring the app stays in sync with the cloud database.

2. **Block configuration when offline**: If the API is unavailable, users cannot configure the scanner name. This prevents invalid entries that would fail during sync.

3. **Read-only API access**: The app only reads from the scanners endpoint - it never creates, updates, or deletes scanners.

## Files Affected

- `src/main/main.ts` - Add IPC handler for fetching scanners
- `src/main/preload.ts` - Expose scanner API to renderer
- `src/types/electron.d.ts` - Add scanner types
- `src/renderer/MachineConfiguration.tsx` - Replace text input with dropdown
- `tests/unit/pages/MachineConfiguration.test.tsx` - Update tests

## Risks & Mitigations

| Risk                               | Mitigation                                                           |
| ---------------------------------- | -------------------------------------------------------------------- |
| API unavailable blocks setup       | Clear error message with retry option                                |
| API credentials not yet configured | First-time flow allows entering credentials before scanner selection |
| Network latency                    | Show loading spinner during fetch                                    |
