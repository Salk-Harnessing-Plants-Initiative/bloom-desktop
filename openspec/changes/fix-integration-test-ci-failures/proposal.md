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
- Which import path was being attempted (hardware.* vs python.hardware.*)
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

## References

- PR #61: https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/pull/61
- PyInstaller Documentation: https://pyinstaller.org/en/stable/hooks.html
- Related issue: Integration tests failing in CI (resolved)

## Lessons Learned

1. **PyInstaller metadata requirements are not obvious** - Packages that use `importlib.metadata` need explicit metadata copying
2. **Build caching can hide configuration issues** - Always clean cache when testing spec changes
3. **Diagnostic logging is invaluable** - STATUS messages revealed the exact failure point
4. **CI/local parity requires effort** - Bundled apps behave differently than source execution
5. **Systematic debugging wins** - Methodical investigation with logging beats guesswork
