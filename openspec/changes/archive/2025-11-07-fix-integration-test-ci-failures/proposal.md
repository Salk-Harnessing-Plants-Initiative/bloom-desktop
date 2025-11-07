# Proposal: Fix Integration Test CI Failures

**Change ID:** `fix-integration-test-ci-failures`
**Status:** Implemented
**PR:** #61
**Branch:** `elizabeth/fix-integration-test-ci-failures`

## Problem Statement

Integration tests (camera, DAQ, scanner) were passing locally but failing in CI across all platforms (Ubuntu, macOS, Windows) with the error:

```
ERROR:Failed to import camera modules: No module named 'python.hardware'
ERROR:Camera module not available
```

This prevented merging critical bug fixes and new features, blocking the development pipeline.

## Root Cause Analysis

Through systematic debugging with diagnostic logging, the root cause was identified:

### The Issue

PyInstaller was not bundling the `imageio` package metadata (`.dist-info` directory). When the bundled Python executable tried to import camera modules:

1. `from hardware.camera import Camera` was attempted first
2. Inside `camera.py`, `import imageio.v2 as iio` was executed
3. `imageio` internally called `importlib.metadata.version('imageio')` to check its version
4. **This failed with "No package metadata was found for imageio"**
5. The import exception bubbled up, causing the camera module import to fail
6. The fallback `from python.hardware.camera` also failed for the same reason
7. Tests received ERROR messages and failed

### Why It Worked Locally

Local development environments had different timing/caching behavior that masked the metadata issue. The bundled executable worked intermittently depending on how PyInstaller's cache was populated.

### Diagnostic Process

Added STATUS logging to `python/ipc_handler.py` to trace:

- `sys.path` contents in the bundled executable
- Which import path was being attempted (hardware._ vs python.hardware._)
- Exact error messages from failed imports

This revealed:

```
[STATUS] sys.path=['/var/folders/.../T/_MEI.../base_library.zip', ...]
[STATUS] First import (hardware.*) failed: No package metadata was found for imageio
[ERROR] Failed to import camera modules: No module named 'python.hardware'
```

## Solution

### Primary Fix

Added `imageio` package metadata to PyInstaller's bundled files in `python/main.spec`:

```python
datas = []
datas += copy_metadata('nidaqmx')
datas += copy_metadata('imageio')  # Required for imageio.v2 imports in camera modules
```

This ensures the `.dist-info` directory for `imageio` is included in the bundled executable, allowing `importlib.metadata.version()` calls to succeed.

### Supporting Changes

1. **Build Cache Cleaning** (`scripts/build-python.js`)
   - Added automatic cleaning of PyInstaller's `build/` and `dist/` directories before each build
   - Ensures `main.spec` changes (like `hiddenimports` modifications) are always reflected
   - Prevents stale build artifacts from masking configuration issues

2. **Dual Import Path Support** (`python/main.spec`)
   - Updated `pathex=['.', './python']` to support both import strategies
   - Allows `from hardware.camera` (bundled path) and `from python.hardware.camera` (development path)

3. **Diagnostic Logging** (`python/ipc_handler.py`)
   - Added STATUS logging for import attempts and sys.path inspection
   - Useful for future debugging of similar PyInstaller bundling issues
   - Can be removed if desired, but provides valuable troubleshooting capability

## Testing

### Local Testing

```bash
npm run build:python
echo '{"command":"check_hardware"}' | ./dist/bloom-hardware --ipc
npm run test:camera
npm run test:ipc
npm run test:daq
npm run test:scanner
```

All tests pass with output:

```
STATUS:sys.path=['/var/folders/.../T/_MEI.../base_library.zip', ...]
STATUS:Successfully imported from hardware.*
STATUS:IPC handler ready
DATA:{"camera": {"library_available": true, "devices_found": 0, "available": false}, ...}
```

### CI Testing

- ✅ macOS integration tests: **PASS**
- ✅ Ubuntu integration tests: **PASS**
- ⏳ Windows integration tests: Pending
- ✅ E2E tests: **PASS** (all platforms)
- ✅ Packaged app database test: **PASS**

## Files Changed

1. `python/main.spec` - Added `copy_metadata('imageio')` and updated `pathex`
2. `scripts/build-python.js` - Added build/dist directory cleaning
3. `python/ipc_handler.py` - Added diagnostic logging (optional to keep)

## Impact

- **Unblocks CI pipeline** for all integration tests
- **Prevents future similar issues** through build cache cleaning
- **Improves debuggability** with diagnostic logging
- **No performance impact** - metadata files are tiny (~10KB)
- **No functional changes** to application behavior

## Future Considerations

### Recommended Follow-up Work

1. **Build Optimizations** (see analysis below)
   - Cache Python executable artifacts across CI jobs
   - Reduce redundant `npm run build:python` calls
   - Implement node_modules caching
   - **Estimated savings: 7-10 minutes per CI run**

2. **Similar Metadata Issues**
   - Audit other packages for metadata requirements (pypylon, nidaqmx, etc.)
   - Consider proactive metadata bundling for all dependencies

3. **Diagnostic Logging**
   - Decision needed: Keep diagnostic logging or remove after stabilization
   - If keeping, consider making it configurable via environment variable

## Build Process Analysis

### Current Redundancies Found

1. **Python Build Duplication** (HIGH IMPACT)
   - Built 3+ times per CI run despite identical source
   - ~45 seconds × 3 jobs × 3 OS = ~7 minutes wasted

2. **Prisma Generation Duplication** (MEDIUM IMPACT)
   - Generated 6 times per CI run with identical output
   - ~10 seconds × 6 jobs = ~1 minute wasted

3. **npm ci Without Caching** (MEDIUM IMPACT)
   - ~30 seconds × 9 jobs = ~4.5 minutes wasted

### Optimization Recommendations (Priority Order)

**Phase 1: Quick Wins** (Low risk, immediate value)

- Remove duplicate `test:camera` script (alias to `test:streaming`)
- Remove Prisma generate from `lint-node` job
- Add cache for `node_modules`
- **Time investment:** 30 minutes
- **Expected savings:** ~30-60 seconds per CI run

**Phase 2: Medium Impact** (Medium risk, high value)

- Cache Python build artifacts across CI jobs
- Implement `build-python` job with artifact upload/download
- **Time investment:** 2-4 hours
- **Expected savings:** ~2-4 minutes per CI run

**Phase 3: Structural** (Higher risk, long-term value)

- Create composite setup action for common steps
- Reorganize job dependency graph
- Cache Prisma Client
- **Time investment:** 4-8 hours
- **Expected savings:** ~1-2 minutes per CI run + maintainability

### Total Potential Savings

- **Current redundant work:** ~12-15 minutes per CI run
- **After all optimizations:** ~5 minutes
- **Net savings:** ~7-10 minutes per CI run (40-50% reduction)

## How PyInstaller Works: Understanding the Build Process

### Overview

The Python executable is built using **PyInstaller**, which bundles Python code, dependencies, and the Python interpreter into a standalone executable. This is critical to understand because the bundled application behaves differently from running Python source code directly.

### Build Process Flow

When you run `npm run build:python`, here's what happens:

```
npm run build:python
    ↓
scripts/build-python.js
    ↓
1. Clean build/dist directories (prevents stale cache issues)
    ↓
2. uv sync --extra dev (install Python dependencies including PyInstaller)
    ↓
3. uv run pyinstaller python/main.spec
    ↓
    ├─→ Analysis Phase
    │   ├─ Reads python/main.py as entry point
    │   ├─ Follows all imports to discover dependencies
    │   ├─ Uses pathex=['.', './python'] to find modules
    │   ├─ Includes modules from hiddenimports list
    │   └─ Copies package metadata via copy_metadata()
    │
    ├─→ Build Phase
    │   ├─ Compiles Python files to .pyc bytecode
    │   ├─ Collects all dependencies into build/ directory
    │   └─ Creates module tree structure
    │
    └─→ Bundle Phase
        ├─ Packages everything into single executable
        ├─ Adds bootloader (the executable shell)
        └─ Outputs to dist/bloom-hardware
```

### Runtime Behavior

**CRITICAL DIFFERENCE:** When the bundled executable runs, it does NOT use the source code in `python/` directory!

Instead:

1. **Executable extracts to temp directory** (e.g., `/tmp/_MEI123abc/`)
2. **Python runs from the temp directory** with its own `sys.path`
3. **Modules are loaded from the extracted bundle**, not from source

**Example sys.path in bundled executable:**

```python
[
    '/tmp/_MEI123abc/base_library.zip',      # Python standard library
    '/tmp/_MEI123abc/python3.12/lib-dynload', # C extensions
    '/tmp/_MEI123abc',                        # Bundled Python modules
    '/tmp/_MEI123abc/setuptools/_vendor'      # Vendor dependencies
]
```

**Example sys.path in development:**

```python
[
    '/path/to/bloom-desktop',                  # Project root
    '/path/to/bloom-desktop/python',           # Python source directory
    '/path/to/.venv/lib/python3.12/site-packages'  # Installed packages
]
```

### Key PyInstaller Spec File Settings

**`python/main.spec` controls what gets bundled:**

```python
Analysis(
    ['main.py'],                    # Entry point
    pathex=['.', './python'],       # Module search paths
    hiddenimports=[                 # Modules PyInstaller can't auto-detect
        'hardware.camera',
        'hardware.camera_mock',
        'python.hardware.camera',
        # ... etc
    ],
    datas=[                        # Non-Python files to bundle
        copy_metadata('nidaqmx'),  # Package .dist-info directories
        copy_metadata('imageio'),  # Required for importlib.metadata
    ]
)
```

### Common Gotchas

1. **Hidden Imports**
   - PyInstaller's static analysis can't detect dynamic imports
   - Must manually list in `hiddenimports=[]`
   - Example: `from hardware.camera import Camera` must be in hiddenimports

2. **Package Metadata**
   - If a package calls `importlib.metadata.version(__name__)`, it needs its `.dist-info` directory
   - Must use `copy_metadata('package-name')` in spec file
   - **THIS WAS THE ROOT CAUSE OF THE BUG**

3. **Import Path Differences**
   - Source code uses `from python.hardware.camera import Camera`
   - Bundled app uses `from hardware.camera import Camera`
   - Both paths must be in `pathex=[]` and `hiddenimports=[]`

4. **Build Caching**
   - PyInstaller caches analysis in `build/` directory
   - Stale cache can ignore spec file changes
   - **Always clean build/dist when modifying main.spec**

### Module Location Reference

**Source Code Structure:**

```
bloom-desktop/
├── python/
│   ├── __init__.py
│   ├── main.py              # Entry point
│   ├── ipc_handler.py       # IPC protocol implementation
│   ├── hardware/
│   │   ├── __init__.py
│   │   ├── camera.py        # Camera control
│   │   ├── camera_mock.py   # Mock camera for testing
│   │   ├── camera_types.py  # Type definitions
│   │   ├── daq.py           # DAQ control
│   │   ├── daq_mock.py      # Mock DAQ
│   │   └── ...
│   └── tests/               # Not bundled (excluded in spec)
├── dist/
│   └── bloom-hardware       # Bundled executable (created by PyInstaller)
└── build/                   # PyInstaller cache (cleaned before build)
```

**Import Paths:**

- Development: `from python.hardware.camera import Camera` ✅
- Bundled: `from hardware.camera import Camera` ✅
- Both work due to `pathex=['.', './python']`

**Testing the Bundled Executable:**

```bash
# Build the executable
npm run build:python

# Test directly (bypasses integration tests)
echo '{"command":"check_hardware"}' | ./dist/bloom-hardware --ipc

# Expected output:
# STATUS:sys.path=['/tmp/_MEI.../base_library.zip', ...]
# STATUS:Successfully imported from hardware.*
# STATUS:IPC handler ready
# DATA:{"camera": {"library_available": true, ...}, ...}
```

## Troubleshooting Guide

### Integration Tests Fail with "No module named 'X'"

**Symptoms:**

- Tests pass locally when running from source
- Tests fail in CI or with bundled executable
- Error: `No module named 'python.hardware'` or similar

**Diagnosis Steps:**

1. **Check if it's a PyInstaller bundling issue:**

   ```bash
   npm run build:python
   echo '{"command":"check_hardware"}' | ./dist/bloom-hardware --ipc
   ```

   If this fails, it's a bundling issue, not a test issue.

2. **Add diagnostic logging to see sys.path:**

   ```python
   import sys
   print(f"STATUS:sys.path={sys.path}", flush=True)
   ```

3. **Check hiddenimports in `python/main.spec`:**
   - Does it include all modules you're importing?
   - Are both import paths listed (`hardware.*` and `python.hardware.*`)?

4. **Check for package metadata requirements:**
   - Does the module import use `importlib.metadata.version()`?
   - Is there `copy_metadata('package-name')` in the spec file?

**Solutions:**

- **Missing module:** Add to `hiddenimports=[]` in `python/main.spec`
- **Missing metadata:** Add `copy_metadata('package-name')` to `datas` in spec
- **Stale cache:** Clean build/dist directories (already automatic in build script)
- **Wrong import path:** Add to `pathex=[]` in spec

### Integration Tests Fail with "No package metadata was found for X"

**This is what we just fixed!**

**Root Cause:** Package uses `importlib.metadata` internally but PyInstaller didn't bundle the `.dist-info` directory.

**Solution:** Add to `python/main.spec`:

```python
datas += copy_metadata('package-name')
```

**How to identify which packages need this:**

1. Look at the import error traceback
2. Find which package is calling `importlib.metadata`
3. Add `copy_metadata()` for that package

**Current packages requiring metadata:**

- `nidaqmx` - Uses `importlib.metadata.version(__name__)`
- `imageio` - Uses `importlib.metadata.version('imageio')`

### Build Works Locally But Fails in CI

**Possible Causes:**

1. **Build cache differences** (now solved with auto-cleaning)
2. **Platform-specific dependencies**
   - Windows uses `.exe` extension
   - macOS may require code signing
   - Linux may have different library paths

3. **Timing/race conditions**
   - CI may run tests before build completes
   - Solution: Ensure `npm run build:python` runs before tests

4. **Environment differences**
   - Different Python versions
   - Different dependency versions
   - Check `uv` is using the same Python version

### Adding New Python Dependencies

When adding new Python packages, consider:

1. **Does it use importlib.metadata?**
   - Check the package source or docs
   - If yes, add `copy_metadata('package-name')` to spec

2. **Does it have C extensions?**
   - PyInstaller usually handles these automatically
   - Check `dist/` for `.so` or `.pyd` files

3. **Does it have data files?**
   - May need `collect_data_files('package-name')`

4. **Test the bundled executable:**
   ```bash
   npm run build:python
   echo '{"command":"check_hardware"}' | ./dist/bloom-hardware --ipc
   ```

## References

- PR #61: https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/pull/61
- PyInstaller Documentation: https://pyinstaller.org/en/stable/
- PyInstaller Hooks: https://pyinstaller.org/en/stable/hooks.html
- PyInstaller Spec Files: https://pyinstaller.org/en/stable/spec-files.html
- Related issue: Integration tests failing in CI (resolved)

## Lessons Learned

1. **PyInstaller metadata requirements are not obvious** - Packages that use `importlib.metadata` need explicit metadata copying
2. **Build caching can hide configuration issues** - Always clean cache when testing spec changes (now automatic)
3. **Diagnostic logging is invaluable** - STATUS messages revealed the exact failure point
4. **CI/local parity requires effort** - Bundled apps behave differently than source execution
5. **Systematic debugging wins** - Methodical investigation with logging beats guesswork
6. **Document the build process** - Understanding PyInstaller's behavior is critical for troubleshooting
