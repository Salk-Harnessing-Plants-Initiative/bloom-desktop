# E2E Database Path Parsing: Root Cause and Fix

## Executive Summary

**Problem**: E2E tests fail with "Error code 14: Unable to open database file" when using BLOOM_DATABASE_URL with absolute paths.

**Root Cause**: The regex `replace(/^file:\/?\/?/, '')` in `database.ts` incorrectly stripped leading slashes from absolute file:// URLs.

**Example of the bug**:
- Input: `file:/Users/elizabethberrigan/repos/bloom-desktop/tests/e2e/test.db`
- After regex: `Users/elizabethberrigan/repos/...` (WRONG - missing leading `/`)
- Expected: `/Users/elizabethberrigan/repos/...`

**Solution**: Use `new URL()` parsing instead of regex, which correctly preserves absolute paths.

## Technical Details

### The Bug (Commit ed9272b)

```typescript
// BROKEN CODE - strips leading slash from absolute paths
const rawPath = process.env.BLOOM_DATABASE_URL.replace(/^file:\/?\/?/, '');
```

For `file:/path/to/db`:
1. Regex matches `file:/`
2. Replace with empty string
3. Result: `path/to/db` (missing leading `/`)

### The Fix (Commit 30cd920)

```typescript
// CORRECT CODE - properly parses file:// URLs
const url = new URL(process.env.BLOOM_DATABASE_URL);
dbPath = decodeURIComponent(url.pathname);
// url.pathname correctly returns `/path/to/db` with leading slash
```

For `file:/path/to/db`:
1. `new URL()` parses the URL
2. `url.pathname` returns `/path/to/db` (correct!)
3. Windows fix: Remove leading slash from `/C:/path` → `C:/path`

### Why URL() is Better

1. **Preserves leading slashes** on Unix paths
2. **Handles Windows paths** correctly (`/C:/` → `C:/`)
3. **Decodes URL encoding** (spaces, special chars)
4. **Standard API** - well-tested, no edge cases

## Diagnosis Tips

If you see "Error code 14: Unable to open database file":

1. Check CI logs for `[Database] Using BLOOM_DATABASE_URL:` line
2. Verify path has leading `/` for absolute paths
3. Wrong: `home/runner/work/...` or `Users/foo/...`
4. Correct: `/home/runner/work/...` or `/Users/foo/...`

## Related Files

- `src/main/database.ts` - Contains the fix
- `tests/e2e/*.e2e.ts` - Tests that use BLOOM_DATABASE_URL
- `.env.e2e` - E2E test database configuration
- `docs/E2E_TESTING.md` - Documentation with pitfall section

## Historical Note

This bug was introduced when simplifying the BLOOM_DATABASE_URL parsing logic. The working code from PR #63 used `new URL()` parsing. Always use `new URL()` for file:// URL parsing - never regex.
