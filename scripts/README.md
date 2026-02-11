# Development Scripts

This directory contains utility scripts for development and testing.

## Directory Structure

```
scripts/
├── examples/           # Template scripts (safe to commit)
│   └── test-bloom-api.example.js
└── *.js               # Actual scripts with credentials (git-ignored)
```

## Available Examples

### Bloom API Connection Test

**Purpose**: Test Bloom API authentication and scanner fetching using Supabase.

**Location**: `examples/test-bloom-api.example.js`

**Setup**:

```bash
# 1. Copy the example to create your test script
cp scripts/examples/test-bloom-api.example.js scripts/test-bloom-api.js

# 2. The script will automatically use credentials from .env:
#    - BLOOM_API_URL
#    - BLOOM_ANON_KEY
#    - BLOOM_TEST_USERNAME
#    - BLOOM_TEST_PASSWORD

# 3. Run the test
node scripts/test-bloom-api.js
```

**What it does**:

1. Creates a Supabase client with your API URL and anon key
2. Authenticates using email/password via `signInWithPassword()`
3. Queries the `cyl_scanners` table using `SupabaseStore.getAllCylScanners()`
4. Displays the list of available scanners

**Expected output**:

```
✅ Authentication successful!
📊 Found 4 scanners:
  1. ID: 1, Name: FastScanner
  2. ID: 2, Name: SlowScanner
  3. ID: 3, Name: Unknown
  4. ID: 4, Name: PBIOBScanner
```

**Troubleshooting**:

- **401 Authentication failed**: Check your username/password in `.env`
- **Network error**: Verify API URL is correct and accessible
- **Module not found**: Run `npm install` to install dependencies

## Adding New Examples

When creating new example scripts:

1. **Save template in `examples/`**: Use `.example.js` extension
2. **Use environment variables**: Reference `.env` for all credentials
3. **Add to .gitignore**: Actual scripts (without `.example`) are auto-ignored by `scripts/*.js` pattern
4. **Document here**: Add usage instructions to this README

## Security Notes

⚠️ **NEVER commit actual credentials!**

- ✅ `examples/*.example.js` - Safe to commit (uses placeholders/env vars)
- ❌ `scripts/*.js` (non-example) - Git-ignored, contains real credentials
- ❌ `.env` - Git-ignored, contains all credentials
- ✅ `.env.example` - Safe to commit (template only)

The `.gitignore` automatically ignores:

- `scripts/*.js` (except in examples/ subdirectory)
- `.env`
- `.npmrc`
