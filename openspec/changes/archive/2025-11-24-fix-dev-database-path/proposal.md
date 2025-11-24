# Fix Development Database Path Parsing

## Why

### Problem Statement

When running `npm run start` (development mode) with `BLOOM_DATABASE_URL` set (via shell, IDE, or direnv), the database fails to open:
```
[Database] Using BLOOM_DATABASE_URL: /prisma/dev.db
Error querying the database: Error code 14: Unable to open the database file
```

The path `/prisma/dev.db` is incorrect - it's an absolute path at the filesystem root instead of the intended relative path `./prisma/dev.db` in the project directory.

### Root Cause

**The file:// URL parsing doesn't support relative paths.**

The `.env` file contains:
```
BLOOM_DATABASE_URL="file:./prisma/dev.db"
```

When this is parsed by Node.js `new URL()`:
```javascript
const url = new URL('file:./prisma/dev.db');
console.log(url.pathname); // Output: "/prisma/dev.db" (WRONG!)
```

The `file://` protocol (RFC 8089) is designed for **absolute paths only**. The `./` in `./prisma/dev.db` is treated as a path component starting at root, not as a relative path operator.

**Current code path in `database.ts` (lines 164-184):**
```typescript
} else if (process.env.BLOOM_DATABASE_URL) {
  try {
    const url = new URL(process.env.BLOOM_DATABASE_URL);
    dbPath = decodeURIComponent(url.pathname);  // Returns "/prisma/dev.db"
    // ...
  } catch (error) {
    // Fallback
  }
}
```

### Why E2E Tests Work

E2E tests succeed because they:
1. Use `.env.e2e` with absolute test paths
2. Pass absolute paths directly to `initializeDatabase(customPath)`
3. Bypass the environment variable parsing entirely

### User Impact

- **Blocked**: Cannot run dev server with BLOOM_DATABASE_URL set to relative path
- **Workaround**: Unset BLOOM_DATABASE_URL or use absolute path
- **Affects**: Developers with IDE/shell that auto-loads .env files

## What Changes

### Fix: Handle relative file:// paths in database.ts

Add detection for relative path format before URL parsing.

**File**: `src/main/database.ts`

**Current code:**
```typescript
} else if (process.env.BLOOM_DATABASE_URL) {
  try {
    const url = new URL(process.env.BLOOM_DATABASE_URL);
    // ...
```

**Fixed code:**
```typescript
} else if (process.env.BLOOM_DATABASE_URL) {
  const envUrl = process.env.BLOOM_DATABASE_URL;

  // Check for relative path format: file:./path
  // This is a common developer-friendly format but file:// URLs only support absolute paths
  const relativeMatch = envUrl.match(/^file:(\.\/.*)$/);
  if (relativeMatch) {
    const relativePath = relativeMatch[1]; // "./prisma/dev.db"
    dbPath = path.resolve(app.getAppPath(), relativePath);
    console.log('[Database] Using BLOOM_DATABASE_URL (relative):', relativePath, '->', dbPath);
  } else {
    // Existing absolute path handling
    try {
      const url = new URL(envUrl);
      // ...
```

### Update .env documentation

Clarify supported formats in `.env` comments:
- `file:./relative/path` - Resolved relative to app root
- `file:///absolute/path` - Used as-is

### No Breaking Changes

- Existing absolute paths continue to work
- Fallback behavior preserved
- E2E tests unaffected

## Impact

### On Development Workflow

- **Fixes**: `npm run start` works with `file:./prisma/dev.db`
- **Maintains**: All existing workflows unchanged

### On Testing

- Existing E2E tests pass (use absolute paths)
- Add unit test for relative path resolution
- Manual verification of `npm run start`

## Related

### Reference

- RFC 8089: The "file" URI Scheme (specifies absolute paths only)
- Node.js URL API behavior
- Electron `app.getAppPath()` in development mode