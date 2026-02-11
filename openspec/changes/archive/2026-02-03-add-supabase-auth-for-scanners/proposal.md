# Proposal: Add Supabase Authentication for Scanner Fetch

**Status:** Draft
**Author:** AI Assistant
**Created:** 2026-01-27
**Change ID:** add-supabase-auth-for-scanners

## Problem Statement

The current `fetchScannersFromBloom()` implementation incorrectly uses raw `fetch()` API and passes the user's password directly as a Bearer token, which fails with 401 authentication errors. The Bloom API uses Supabase authentication, which requires:

1. **Proper authentication flow**: Use Supabase client's `signInWithPassword()` to obtain an access token
2. **Use access token**: Pass the session's access token (not the password) for API requests
3. **Use Supabase client methods**: Query the `cyl_scanners` table using Supabase client, not raw HTTP

**Current broken code:**

```typescript
const response = await fetch(`${apiUrl}/scanners`, {
  headers: {
    Authorization: `Bearer ${credentials.bloom_scanner_password}`, // ❌ Wrong!
  },
});
```

**Evidence from pilot code:**

- Uses `@supabase/supabase-js` client library
- Authenticates with `supabase.auth.signInWithPassword()`
- Uses `@salk-hpi/bloom-js` `SupabaseStore.getAllCylScanners()` method
- Queries `cyl_scanners` table (not `/scanners` endpoint)

## Proposed Solution

Replace the broken authentication with proper Supabase client authentication matching the pilot implementation:

### Implementation Approach

1. **Install dependencies**:
   - `@supabase/supabase-js`: Supabase client library
   - `@salk-hpi/bloom-js`: Bloom-specific helpers including `SupabaseStore`

2. **Rewrite `fetchScannersFromBloom()`**:

   ```typescript
   export async function fetchScannersFromBloom(
     apiUrl: string,
     credentials: MachineCredentials
   ): Promise<FetchScannersResult> {
     try {
       // Create Supabase client
       const supabase = createClient(apiUrl, credentials.bloom_anon_key);

       // Authenticate to get access token
       const { error: authError } = await supabase.auth.signInWithPassword({
         email: credentials.bloom_scanner_username,
         password: credentials.bloom_scanner_password,
       });

       if (authError) {
         return {
           success: false,
           error: `Authentication failed: ${authError.message}`,
         };
       }

       // Use SupabaseStore to query scanners
       const store = new SupabaseStore(supabase);
       const { data, error } = await store.getAllCylScanners();

       if (error) {
         return {
           success: false,
           error: `Failed to fetch scanners: ${error.message}`,
         };
       }

       return { success: true, scanners: data };
     } catch (error) {
       return { success: false, error: `Network error: ${error.message}` };
     }
   }
   ```

3. **Update Scanner type** to match database schema:
   ```typescript
   export interface Scanner {
     id: number;
     name: string | null;
   }
   ```

### Benefits

- **Fixes authentication**: Uses proper Supabase auth flow
- **Matches pilot**: Same authentication pattern as existing working code
- **Type-safe**: Uses Bloom's typed database schemas
- **Read-only**: `getAllCylScanners()` only performs SELECT query
- **Better error handling**: Supabase client provides detailed error messages

## Scope

### In Scope

- Install `@supabase/supabase-js` and `@salk-hpi/bloom-js` packages
- Rewrite `fetchScannersFromBloom()` to use Supabase client
- Update `Scanner` type to match `cyl_scanners` table schema
- Update tests to mock Supabase client instead of fetch
- Add UX improvement: fetch scanners after credential save (if credentials changed)

### Out of Scope

- Changing credential storage format
- Adding session token caching
- Implementing token refresh logic
- Changing UI components (except for triggering fetch after save)

## Dependencies

- Pilot codebase (reference implementation)
- `@salk-hpi/bloom-js` package from bloom monorepo
- Bloom API Supabase instance

## Risks and Mitigations

| Risk                    | Impact | Mitigation                                                    |
| ----------------------- | ------ | ------------------------------------------------------------- |
| Package size increase   | Low    | Both packages are already used in pilot, sizes are reasonable |
| Breaking existing tests | Medium | Update mocks to match Supabase client API                     |
| Auth token expiration   | Low    | Each fetch creates new authenticated session                  |

## Success Criteria

- Authentication succeeds with test credentials
- Scanner list fetches successfully from `cyl_scanners` table
- All existing tests pass with updated mocks
- Manual testing confirms scanner dropdown populates
- After saving credentials for first time, scanner list auto-fetches

## Test Strategy

1. **Unit tests**: Mock Supabase client's auth and query methods
2. **Integration test**: Use test credentials to verify real API connection
3. **Manual test**: Verify scanner dropdown populates in UI

## Related Issues

- Scanner name validation feature (depends on this fix)
- Machine Configuration UX improvements
