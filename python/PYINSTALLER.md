# PyInstaller Build Guide

This document explains how the Python executable is built and how to troubleshoot common issues.

## Quick Reference

### Build the Python executable
```bash
npm run build:python
```

### Test the bundled executable directly
```bash
echo '{"command":"check_hardware"}' | ./dist/bloom-hardware --ipc
```

### Run integration tests
```bash
npm run test:camera    # Camera streaming tests
npm run test:ipc       # IPC protocol tests
npm run test:daq       # DAQ control tests
npm run test:scanner   # Scanner tests
```

## How It Works

When you run `npm run build:python`, PyInstaller:

1. **Cleans** `build/` and `dist/` directories (prevents stale cache)
2. **Installs** Python dependencies with `uv sync --extra dev`
3. **Analyzes** `python/main.py` to discover all imports
4. **Bundles** Python code, dependencies, and interpreter into `dist/bloom-hardware`

**IMPORTANT:** The bundled executable does NOT use source code from `python/` directory!

At runtime, the executable:
- Extracts to a temp directory (e.g., `/tmp/_MEI123abc/`)
- Runs Python from the temp directory
- Loads modules from the extracted bundle

## Configuration: main.spec

The `python/main.spec` file controls what gets bundled:

```python
Analysis(
    ['main.py'],                    # Entry point
    pathex=['.', './python'],       # Module search paths
    hiddenimports=[...],            # Modules PyInstaller can't auto-detect
    datas=[...],                    # Non-Python files (metadata, data files)
)
```

### When to Update main.spec

#### 1. Adding New Python Modules
If you create a new module in `python/hardware/`, add it to `hiddenimports`:

```python
hiddenimports=[
    'hardware.new_module',
    'python.hardware.new_module',  # Both paths needed
]
```

#### 2. Adding New Dependencies
If the new package uses `importlib.metadata`, add metadata:

```python
datas += copy_metadata('package-name')
```

**Packages currently requiring metadata:**
- `nidaqmx` - Uses `importlib.metadata.version(__name__)`
- `imageio` - Uses `importlib.metadata.version('imageio')`

## Troubleshooting

### Tests Pass Locally But Fail in CI

**Symptom:** `ERROR:Failed to import X modules: No module named 'python.hardware'`

**Diagnosis:**
```bash
npm run build:python
echo '{"command":"check_hardware"}' | ./dist/bloom-hardware --ipc
```

If this fails, it's a PyInstaller bundling issue.

**Common Causes:**

1. **Missing hiddenimports**
   - Solution: Add module to `hiddenimports=[]` in `main.spec`

2. **Missing package metadata**
   - Solution: Add `copy_metadata('package-name')` to `datas` in `main.spec`

3. **Stale build cache** (should not happen, auto-cleaned)
   - Manual fix: `rm -rf build/ dist/` then rebuild

### "No package metadata was found for X"

This means a package is calling `importlib.metadata.version()` but PyInstaller didn't bundle its `.dist-info` directory.

**Solution:**
```python
# In python/main.spec
datas += copy_metadata('package-name')
```

**How to identify which package:**
1. Look at the error traceback
2. Find which package is calling `importlib.metadata`
3. Add `copy_metadata()` for that package

### Import Path Confusion

The codebase supports two import paths:

- **Development:** `from python.hardware.camera import Camera`
- **Bundled:** `from hardware.camera import Camera`

Both work because:
- `pathex=['.', './python']` tells PyInstaller where to find modules
- `hiddenimports=[]` lists both import paths

**Example from ipc_handler.py:**
```python
try:
    # Try bundled app import path
    from hardware.camera import Camera
except ImportError:
    # Fall back to development import path
    from python.hardware.camera import Camera
```

## Module Locations

```
bloom-desktop/
├── python/
│   ├── main.py              # Entry point (spawned by Electron)
│   ├── ipc_handler.py       # IPC protocol implementation
│   ├── hardware/
│   │   ├── camera.py        # Camera control
│   │   ├── camera_mock.py   # Mock camera for CI
│   │   ├── daq.py           # DAQ control
│   │   ├── scanner.py       # Scanner control
│   │   └── ...
│   └── tests/               # Unit tests (NOT bundled)
├── dist/
│   └── bloom-hardware       # Bundled executable (gitignored)
└── build/                   # PyInstaller cache (gitignored)
```

## Common Gotchas

### 1. Hidden Imports
PyInstaller's static analysis can't detect:
- Dynamic imports (`importlib.import_module()`)
- Conditional imports (`if condition: import X`)
- Plugin systems

**Solution:** Manually add to `hiddenimports=[]`

### 2. Package Metadata
If a package uses `importlib.metadata.version()`, it needs metadata bundled.

**Solution:** Add `copy_metadata('package-name')`

### 3. sys.path Differences
In development, `sys.path` includes `python/` directory.
In bundled app, `sys.path` only includes the temp extraction directory.

**Solution:** Use `pathex=['.', './python']` in spec

### 4. Build Caching
PyInstaller caches analysis results in `build/` directory.
Stale cache can ignore spec file changes.

**Solution:** Build script now auto-cleans before building

## Testing Changes

Always test both ways:

1. **Test bundled executable:**
   ```bash
   npm run build:python
   echo '{"command":"check_hardware"}' | ./dist/bloom-hardware --ipc
   ```

2. **Run integration tests:**
   ```bash
   npm run test:camera
   npm run test:ipc
   npm run test:daq
   npm run test:scanner
   ```

3. **Check CI passes** on all platforms (Linux, macOS, Windows)

## More Information

For detailed analysis of the integration test fix and PyInstaller deep dive, see:
- `openspec/changes/fix-integration-test-ci-failures/proposal.md`

For PyInstaller documentation:
- https://pyinstaller.org/en/stable/
- https://pyinstaller.org/en/stable/spec-files.html
- https://pyinstaller.org/en/stable/hooks.html
