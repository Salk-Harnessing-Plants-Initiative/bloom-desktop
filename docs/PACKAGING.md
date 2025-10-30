# Bloom Desktop - Packaging & Distribution

This document describes how Bloom Desktop is packaged for distribution, with special focus on critical configurations required for Prisma ORM and Python executable bundling.

## Overview

Bloom Desktop packages into a standalone application using Electron Forge with:

- **Build system**: Electron Forge + Webpack 5
- **Package format**: ASAR archive with selected files unpacked
- **External resources**: Python executable, Prisma Client binaries
- **Platform targets**: macOS (DMG/ZIP), Windows (Squirrel), Linux (DEB/RPM)

### What Gets Packaged

```
out/Bloom Desktop-darwin-arm64/
├── Bloom Desktop.app/
│   └── Contents/
│       ├── Resources/
│       │   ├── app.asar                    # Main application (compressed)
│       │   ├── app.asar.unpacked/          # Unpacked native modules
│       │   ├── bloom-hardware              # Python executable (extraResource)
│       │   ├── .prisma/                    # Prisma binaries (extraResource)
│       │   │   └── client/
│       │   │       ├── index.js            # Prisma Client entry point
│       │   │       ├── libquery_engine-*   # Native query engine binary
│       │   │       └── schema.prisma       # Database schema
│       │   └── schema.prisma               # Prisma schema (extraResource)
│       └── MacOS/
│           └── Bloom Desktop               # Electron binary
```

### Development vs Production

| Aspect              | Development                    | Production                  |
| ------------------- | ------------------------------ | --------------------------- |
| **Prisma location** | `node_modules/.prisma/client/` | `Resources/.prisma/client/` |
| **Database**        | `prisma/dev.db`                | `~/.bloom/data/bloom.db`    |
| **Python**          | `dist/bloom-hardware` (local)  | `Resources/bloom-hardware`  |
| **Hot reload**      | ✅ Yes                         | ❌ No                       |
| **ASAR archive**    | ❌ No                          | ✅ Yes                      |

## Critical: Prisma Packaging Configuration

### The Problem

When running the packaged Electron app, you may encounter:

```
Error: Cannot find module '@prisma/client'
Require stack:
- /Applications/Bloom Desktop.app/Contents/Resources/app.asar/.webpack/main/index.js
    at Module._resolveFilename (node:internal/modules/cjs/loader:1048:15)
    at Function.n._resolveFilename (electron/js2c/browser_init:2:120241)
```

**This occurs even though**:

- ✅ Prisma works perfectly in development (`npm start`)
- ✅ Dependencies are installed (`npm install` succeeds)
- ✅ Package builds without errors (`npm run package` completes)
- ✅ The Prisma files exist in `node_modules/`

### Root Cause

Electron packages applications into **ASAR archives** - compressed, read-only file formats that improve loading performance. However, this conflicts with Prisma's architecture:

#### 1. Binary Query Engines Cannot Execute from ASAR

Prisma uses native binary engines (`query-engine-darwin`, `libquery_engine-darwin-arm64.dylib.node`, etc.) that must be **executable**. Operating systems cannot execute binaries from read-only archives because:

- ASAR files are virtual filesystems, not real directories
- OS loaders require actual file descriptors for executables
- Memory mapping of executables fails from ASAR

#### 2. Node.js Module Resolution Fails in ASAR

Prisma's client code uses dynamic `require()` calls to load engine binaries. Node.js's module resolution fails when paths are inside ASAR archives because:

- ASAR paths use virtual file system (`/path/to/app.asar/file`)
- `fs.existsSync()` returns `false` for ASAR contents
- `require()` cannot resolve through ASAR indirection
- Dynamic path construction breaks: `require(path.join(...))`

#### 3. Development vs Production Path Mismatch

```
Development:
  import { PrismaClient } from '@prisma/client'
  → Resolves to: node_modules/.prisma/client/index.js ✅

Production (broken):
  import { PrismaClient } from '@prisma/client'
  → Webpack bundles into: app.asar/.webpack/main/index.js
  → Tries to resolve: app.asar/node_modules/.prisma/client/index.js ❌
  → Error: Cannot find module
```

### The Solution Architecture

The fix requires **three coordinated changes**:

1. **Dynamic Module Loading** - Load Prisma from different paths in dev vs production
2. **Webpack Configuration** - Prevent webpack from bundling Prisma files
3. **Forge Packaging** - Copy Prisma files outside ASAR using `extraResource`

```
┌─────────────────────────────────────────────────────────────┐
│  Development                                                 │
│  ┌────────────────┐                                         │
│  │  database.ts   │  import PrismaClient                    │
│  │                │  ↓                                       │
│  │  require()     │  node_modules/.prisma/client/index.js   │
│  └────────────────┘  ✅ Works normally                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Production (Packaged)                                       │
│  ┌────────────────┐                                         │
│  │  database.ts   │  loadPrismaClient()                     │
│  │                │  ↓                                       │
│  │  Dynamic       │  Check: Resources/.prisma/client/       │
│  │  require()     │  ✅ Found! Load from here               │
│  └────────────────┘                                         │
│                                                              │
│  forge.config.ts → extraResource: ['./node_modules/.prisma']│
│                    Copies .prisma/ to Resources/            │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Details

### 1. Dynamic Prisma Client Loading + Module Resolution

**File**: `src/main/database.ts`

The `loadPrismaClient()` function detects the environment and loads Prisma from the correct location. In production, it also sets up the necessary `node_modules` symlink structure for Prisma's internal `require()` calls to work:

```typescript
import { createRequire } from 'module';

function loadPrismaClient(): typeof PrismaClientType {
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    // Development: normal import from node_modules
    const { PrismaClient } = require('@prisma/client');
    return PrismaClient;
  } else {
    // Production: load from Resources directory (outside asar)
    const resourcesPath = process.resourcesPath;

    // Try multiple possible locations for maximum compatibility
    const possiblePaths = [
      path.join(resourcesPath, '.prisma', 'client', 'index.js'),
      path.join(resourcesPath, 'node_modules', '.prisma', 'client', 'index.js'),
      path.join(
        resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        '.prisma',
        'client',
        'index.js'
      ),
    ];

    // Find the first path that exists
    let prismaPath: string | null = null;
    for (const testPath of possiblePaths) {
      if (fs.existsSync(testPath)) {
        prismaPath = testPath;
        break;
      }
    }

    if (!prismaPath) {
      throw new Error(
        `Prisma Client not found. Tried:\n${possiblePaths.join('\n')}`
      );
    }

    // CRITICAL: Set up node_modules symlink structure for Prisma's internal requires
    // Prisma's index.js requires '@prisma/client/runtime/library.js'
    // Node.js searches for '@prisma/client' in node_modules directories
    // We create Resources/node_modules/@prisma/client -> Resources/client symlink
    const nodeModulesDir = path.join(resourcesPath, 'node_modules');
    const prismaModuleDir = path.join(nodeModulesDir, '@prisma');
    const prismaClientSymlink = path.join(prismaModuleDir, 'client');
    const prismaClientActual = path.join(resourcesPath, 'client');

    if (!fs.existsSync(prismaClientSymlink)) {
      fs.mkdirSync(prismaModuleDir, { recursive: true });
      fs.symlinkSync(prismaClientActual, prismaClientSymlink, 'dir');
    }

    // Use createRequire to bypass webpack's bundled require
    const nodeRequire = createRequire(prismaPath);
    const { PrismaClient } = nodeRequire(prismaPath);
    return PrismaClient;
  }
}
```

**Key Design Decisions**:

- **Type-only import**: `import type { PrismaClient }` ensures TypeScript has types but webpack doesn't bundle the module
- **Dynamic require with createRequire**: `createRequire(prismaPath)` bypasses webpack's bundled require to load from absolute paths
- **Runtime symlink creation**: Creates `node_modules/@prisma/client` symlink so Prisma's internal `require('@prisma/client/...')` calls resolve correctly
- **Node.js module resolution**: When Prisma's index.js requires `@prisma/client/runtime/library.js`, Node searches for `node_modules` directories and finds our symlink
- **Multiple fallback paths**: Handles different Electron Forge versions and configurations
- **Detailed logging**: Console logs show exactly which path was checked and used
- **Graceful errors**: If Prisma isn't found, error message shows all attempted paths

**Why the symlink is necessary**:

```
Without symlink:
  Prisma's index.js: require('@prisma/client/runtime/library.js')
  → Node.js searches for node_modules/@prisma/client
  → Not found! Error: Cannot find module '@prisma/client/runtime/library.js'

With symlink:
  Runtime creates: Resources/node_modules/@prisma/client -> Resources/client
  Prisma's index.js: require('@prisma/client/runtime/library.js')
  → Node.js searches for node_modules/@prisma/client
  → Finds symlink at Resources/node_modules/@prisma/client
  → Resolves to Resources/client/runtime/library.js
  → ✅ Success!
```

### 2. Webpack Configuration

**File**: `webpack.rules.ts`

The webpack asset-relocator-loader must **exclude** `.prisma` files:

```typescript
{
  test: /[/\\]node_modules[/\\].+\.(m?js|node)$/,
  parser: { amd: false },
  exclude: /\.prisma/,  // ← Critical: Don't process Prisma files
  use: {
    loader: '@vercel/webpack-asset-relocator-loader',
    options: {
      outputAssetBase: 'native_modules',
    },
  },
}
```

**Why this is necessary**:

- **Without exclusion**: webpack's asset-relocator-loader tries to process and relocate Prisma files
- **Problem**: Relocator breaks Prisma's internal path resolution
- **Result**: Even if files are copied to the right place, Prisma can't find its engine binaries
- **With exclusion**: webpack leaves Prisma files alone, preserving their structure

**What still works**:

- Other native modules (`.node` files) are still relocated correctly
- The exclusion is specific to `.prisma` directory only
- All other node_modules are processed normally

### 3. Forge Packaging Configuration

**File**: `forge.config.ts`

The `extraResource` configuration copies Prisma files **outside** the ASAR archive:

```typescript
const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: '*.{node,dll,dylib,so,prisma,db,db-*}',
    },
    extraResource: [
      // Python executable for hardware control
      process.platform === 'win32'
        ? './dist/bloom-hardware.exe'
        : './dist/bloom-hardware',

      // CRITICAL: Prisma Client must be outside ASAR
      // Binary engines cannot execute from read-only archive
      './node_modules/.prisma', // Generated Prisma Client
      './node_modules/@prisma/client', // Prisma Client package
      './prisma/schema.prisma', // Schema for runtime introspection
    ],
  },
  // ... rest of config
};
```

**Key Configuration Options**:

- **`extraResource`**: Copies files/directories to `Resources/` (outside app.asar)
- **`asar.unpack`**: Pattern for files to unpack from ASAR (we use this for native binaries)
- **Why both?**: `extraResource` puts files in Resources/, `unpack` extracts from ASAR - we use extraResource for Prisma

**What gets copied**:

1. `./node_modules/.prisma` → `Resources/.prisma/`
   - Contains: `client/index.js`, `libquery_engine-*.node`, `schema.prisma`
   - Size: ~20MB (includes native binaries for current platform)

2. `./node_modules/@prisma/client` → `Resources/@prisma/client/`
   - Contains: Package entry points and type definitions
   - Size: ~1MB

3. `./prisma/schema.prisma` → `Resources/schema.prisma`
   - Contains: Database schema for runtime introspection
   - Size: ~3KB

**Directory structure after packaging**:

```
Resources/
├── .prisma/
│   └── client/
│       ├── index.js                          # Entry point
│       ├── index.d.ts                        # TypeScript types
│       ├── libquery_engine-darwin-arm64.dylib.node  # Native binary (macOS ARM)
│       ├── query-engine-windows.exe          # Native binary (Windows)
│       ├── libquery_engine-linux.so          # Native binary (Linux)
│       └── schema.prisma                     # Schema
├── @prisma/
│   └── client/
│       └── index.js                          # Package entry
├── schema.prisma                             # Top-level schema
├── bloom-hardware                            # Python executable
└── app.asar                                  # Main app (everything else)
```

## Verification & Testing

### Manual Verification

After running `npm run package`, verify Prisma files are correctly placed:

```bash
# 1. Check that .prisma directory exists in Resources
ls "out/Bloom Desktop-darwin-arm64/Bloom Desktop.app/Contents/Resources/.prisma/client/"

# Expected output:
# index.js
# index.d.ts
# libquery_engine-darwin-arm64.dylib.node
# schema.prisma
# ... (other Prisma files)

# 2. Run the packaged app and open DevTools (Cmd+Option+I)
# Look for console logs:
open "out/Bloom Desktop-darwin-arm64/Bloom Desktop.app"

# Expected logs:
# [Database] Production mode - resourcesPath: /path/to/Resources
# [Database] Checking for Prisma at: /path/to/Resources/.prisma/client/index.js
# [Database] Found Prisma at: /path/to/Resources/.prisma/client/index.js
# [Database] Initialized at: /Users/username/.bloom/data/bloom.db
```

### Automated Testing

Create a test to verify packaging:

```bash
# Package the app
npm run package

# Run packaged app in test mode
ELECTRON_ENABLE_LOGGING=1 "./out/Bloom Desktop-darwin-arm64/Bloom Desktop.app/Contents/MacOS/Bloom Desktop" --test-mode

# Check logs for Prisma initialization
# Should see: [Database] Found Prisma at: ...
```

### Console Logging

The `loadPrismaClient()` function logs helpful debugging information:

**Development mode**:

```
[Database] Development mode - using standard @prisma/client import
[Database] Initialized at: /path/to/project/prisma/dev.db
```

**Production mode (success)**:

```
[Database] Production mode - resourcesPath: /Applications/Bloom Desktop.app/Contents/Resources
[Database] Checking for Prisma at: /Applications/Bloom Desktop.app/Contents/Resources/.prisma/client/index.js
[Database] Found Prisma at: /Applications/Bloom Desktop.app/Contents/Resources/.prisma/client/index.js
[Database] Production mode - using: /Users/username/.bloom/data/bloom.db
[Database] Initialized at: /Users/username/.bloom/data/bloom.db
```

**Production mode (error)**:

```
[Database] Production mode - resourcesPath: /Applications/Bloom Desktop.app/Contents/Resources
[Database] Checking for Prisma at: /Applications/Bloom Desktop.app/Contents/Resources/.prisma/client/index.js
[Database] Checking for Prisma at: /Applications/Bloom Desktop.app/Contents/Resources/node_modules/.prisma/client/index.js
[Database] Checking for Prisma at: /Applications/Bloom Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/.prisma/client/index.js
[Database] Prisma Client not found. Tried:
  /Applications/Bloom Desktop.app/Contents/Resources/.prisma/client/index.js
  /Applications/Bloom Desktop.app/Contents/Resources/node_modules/.prisma/client/index.js
  /Applications/Bloom Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/.prisma/client/index.js
```

## Troubleshooting

### Error: "Cannot find module '@prisma/client'"

**Symptoms**:

- App works in development (`npm start`)
- Packaged app crashes on launch
- Console shows: `Error: Cannot find module '@prisma/client'`

**Diagnosis**:

**Method 1: DevTools Console** (shows renderer process only)

1. Open packaged app and press `Cmd+Option+I` (macOS) or `Ctrl+Shift+I` (Windows/Linux)
2. Check Console tab for `[Database]` log messages
3. Look for which paths were checked

**Method 2: Terminal Logs** (shows main process logs - **RECOMMENDED**)

```bash
# Run packaged app from terminal to see main process initialization logs
"out/Bloom Desktop-darwin-arm64/Bloom Desktop.app/Contents/MacOS/Bloom Desktop" 2>&1 | grep -E "\[Main\]|\[Database\]"

# This will show:
# - [Main] Initializing database...
# - [Main] Database initialized, registering handlers...
# - [Database] Production mode - resourcesPath: ...
# - [Database] Found Prisma at: ...
# OR errors if initialization fails
```

**Common causes**:

#### Cause 1: Prisma files not copied to Resources

```bash
# Check if .prisma exists in Resources
ls "out/Bloom Desktop-darwin-arm64/Bloom Desktop.app/Contents/Resources/.prisma/"

# If "No such file or directory":
# → extraResource configuration is missing or incorrect
# → Check forge.config.ts includes './node_modules/.prisma'
```

**Fix**: Ensure `forge.config.ts` has:

```typescript
extraResource: [
  './node_modules/.prisma',
  './node_modules/@prisma/client',
  './prisma/schema.prisma',
],
```

#### Cause 2: Prisma Client not generated

```bash
# Check if Prisma Client exists in node_modules
ls node_modules/.prisma/client/

# If "No such file or directory":
# → Prisma Client needs to be generated before packaging
```

**Fix**: Run Prisma generate before packaging:

```bash
npx prisma generate
npm run package
```

#### Cause 3: Wrong environment variable

The app might think it's in development mode when it's actually packaged.

**Fix**: Ensure webpack sets `process.env.NODE_ENV = 'production'` for production builds.

### Error: "Query engine library not found"

**Symptoms**:

- Prisma Client loads successfully
- Error when trying to query database: `Error: Query engine library for current platform could not be found`

**Diagnosis**:

- Prisma Client is loaded, but can't find the native query engine binary
- Check console for: `PrismaClient failed to make request`

**Common causes**:

#### Cause 1: Native binary not copied

The query engine binary (`libquery_engine-*.node` or `query-engine-*.exe`) is missing.

**Fix**: Verify the binary exists:

```bash
ls "out/Bloom Desktop-darwin-arm64/Bloom Desktop.app/Contents/Resources/.prisma/client/"/*.node

# Should see: libquery_engine-darwin-arm64.dylib.node (or similar for your platform)
```

#### Cause 2: Binary not executable

The native binary might have lost execute permissions.

**Fix**: Check and restore permissions:

```bash
chmod +x "out/Bloom Desktop-darwin-arm64/Bloom Desktop.app/Contents/Resources/.prisma/client/"*.node
```

### Error: Database file not found

**Symptoms**:

- Prisma loads successfully
- Error: `SQLITE_CANTOPEN: unable to open database file`

**Diagnosis**:

- Production database path might not be writable
- Check logs for database path: `[Database] Production mode - using: ...`

**Fix**:

- Ensure `~/.bloom/data/` directory exists and is writable
- The app should create this automatically, but might fail due to permissions

### Platform-Specific Issues

#### macOS: "App is damaged and can't be opened"

**Cause**: macOS Gatekeeper blocking unsigned app with unpacked files.

**Fix**:

```bash
# Remove quarantine attribute
xattr -cr "out/Bloom Desktop-darwin-arm64/Bloom Desktop.app"

# For distribution, sign the app with a Developer ID
```

#### Windows: "VCRUNTIME140.dll not found"

**Cause**: Query engine binary requires Visual C++ Runtime.

**Fix**: Include Visual C++ Redistributable in installer or as prerequisite.

#### Linux: "Error loading shared libraries"

**Cause**: Missing system dependencies for query engine.

**Fix**: Install OpenSSL:

```bash
sudo apt-get install openssl libssl3
```

## Future Maintenance

### When Updating Prisma

When upgrading Prisma to a new version:

1. **Test in development first**:

   ```bash
   npm install @prisma/client@latest prisma@latest
   npx prisma generate
   npm start  # Verify works in dev
   ```

2. **Test packaging**:

   ```bash
   npm run package
   # Open packaged app and verify database operations work
   ```

3. **Check for breaking changes**:
   - Review [Prisma release notes](https://github.com/prisma/prisma/releases)
   - Look for changes to:
     - Engine binary names or locations
     - Client generation process
     - Module resolution behavior

4. **Update fallback paths if needed**:
   - If Prisma changes its directory structure, update `possiblePaths` in `loadPrismaClient()`

### When Updating Electron Forge

Electron Forge updates might change:

- ASAR handling behavior
- `extraResource` copying behavior
- `process.resourcesPath` location

**Test checklist**:

- [ ] Verify `extraResource` still copies files to Resources/
- [ ] Check that `process.resourcesPath` points to correct location
- [ ] Confirm native binaries are still executable
- [ ] Test on all target platforms

### Monitoring for Issues

Watch for these patterns in error reports:

1. **"Cannot find module '@prisma/client'"** → Packaging configuration broke
2. **"Query engine library not found"** → Binary not copied or not executable
3. **"SQLITE_CANTOPEN"** → Database path or permissions issue
4. **Works in dev, fails in production** → Environment detection issue

## Related Documentation

- [Database Setup and Management](./DATABASE.md) - Prisma schema, migrations, and development
- [Configuration Constants](./CONFIGURATION.md) - Application settings and defaults
- [Project Structure](./STRUCTURE.md) - Overall codebase organization

## References

- [Electron ASAR Documentation](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- [Electron Forge Packaging](https://www.electronforge.io/guides/framework-integration/webpack#native-modules)
- [Prisma in Electron Discussion](https://github.com/prisma/prisma/discussions/5200)
- [Webpack Asset Relocator Loader](https://github.com/vercel/webpack-asset-relocator-loader)
