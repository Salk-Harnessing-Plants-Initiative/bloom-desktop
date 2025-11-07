# Python Bundling with PyInstaller

Guide for building Python executables with PyInstaller and troubleshooting common issues.

## Building Python Executable

```bash
# Build Python executable (includes dependency installation)
npm run build:python

# Output: dist/bloom-hardware (macOS/Linux) or dist/bloom-hardware.exe (Windows)
```

## Testing Bundled Executable

```bash
# Test IPC protocol directly
echo '{"command":"check_hardware"}' | ./dist/bloom-hardware --ipc

# Expected output:
# {"success": true, "camera_available": true, "daq_available": false}

# Test in integration tests
npm run test:camera
npm run test:scanner
```

## PyInstaller Configuration

### Main Spec File

**Location**: `python/main.spec`

Key sections:

```python
# Hidden imports - modules not detected by PyInstaller
hiddenimports=[
    'hardware.camera',
    'hardware.camera_mock',
    # ... more modules
],

# Data files - non-code files to bundle
datas=[],
datas += copy_metadata('nidaqmx'),  # Package metadata
datas += copy_metadata('imageio'),  # Required for imageio.v2 imports

# Path extensions - import path resolution
pathex=['.', './python'],  # Supports both `from hardware.*` and `from python.hardware.*`
```

## Adding New Python Dependencies

When adding a new Python package:

### Step 1: Update pyproject.toml

```bash
# Add package to dependencies
uv add <package-name>

# Example:
uv add opencv-python
```

### Step 2: Test locally

```bash
# Verify package works in development
uv run python -c "import cv2; print(cv2.__version__)"
```

### Step 3: Check if hidden imports needed

Build and test:

```bash
npm run build:python
echo '{"command":"check_hardware"}' | ./dist/bloom-hardware --ipc
```

If you see `ModuleNotFoundError`:

### Step 4: Add to hiddenimports

Edit `python/main.spec`:

```python
hiddenimports=[
    # ... existing imports
    'cv2',  # Add new package
    'cv2.data',  # Add submodules if needed
],
```

### Step 5: Check if package metadata needed

If package uses `importlib.metadata.version()`:

```python
datas += copy_metadata('opencv-python')  # Add package name
```

## Common Issues

### "Module not found" Error

**Error**: `ModuleNotFoundError: No module named 'some_module'`

**Cause**: PyInstaller didn't detect module import (dynamic import, plugin system, etc.)

**Solution**: Add to `hiddenimports` in `python/main.spec`

```python
hiddenimports=[
    'some_module',
    'some_module.submodule',  # Include submodules too
],
```

**How to find missing modules**:

1. Run bundled executable and check error message
2. Look at package source code - what does it import dynamically?
3. Check package documentation for PyInstaller notes

### "No package metadata found" Error

**Error**: `PackageNotFoundError: No package metadata was found for imageio`

**Cause**: Package calls `importlib.metadata.version('package')` but `.dist-info` not bundled

**Solution**: Add `copy_metadata()` in `python/main.spec`

```python
from PyInstaller.utils.hooks import copy_metadata

datas += copy_metadata('package-name')
```

**Common packages needing this**:
- `imageio`
- `nidaqmx`
- Packages that check their own version at runtime

### DLL/Dylib Loading Issues (Windows/macOS)

**Error**: `OSError: [WinError 126] The specified module could not be found`

**Cause**: Native library (DLL/dylib) not found or in wrong location

**Solution for Windows**:

1. Check if DLL is bundled: `7z l dist/bloom-hardware.exe | grep .dll`
2. Add DLL path to `binaries` in `python/main.spec`:
   ```python
   binaries=[
       ('path/to/library.dll', '.'),
   ]
   ```
3. Or ensure DLL is in system PATH

**Solution for macOS**:

1. Check dylib location: `otool -L dist/bloom-hardware`
2. May need to adjust dylib paths or include in bundle

### Import Works in Dev, Fails in Bundled App

**Cause**: Different `sys.path` in bundled environment

**Debug**:

```python
# Add to python/ipc_handler.py temporarily
import sys
print(f"STATUS:sys.path={sys.path}", flush=True)
```

Run bundled executable and check output.

**Solution**:

1. Verify `pathex=['.', './python']` in `python/main.spec`
2. Use absolute imports: `from hardware.camera import Camera` (not relative imports)
3. Add missing paths to `pathex` if needed

### Build Cache Issues

**Symptom**: Changes to `main.spec` not reflected in build

**Cause**: PyInstaller cache contains stale data

**Solution**: Build script automatically cleans cache, but if issues persist:

```bash
# Manual cache clean
rm -rf build/ dist/
npm run build:python
```

## Platform-Specific Issues

### Windows

**DLL Search Path**:
- Windows looks for DLLs in: executable directory, system32, PATH
- PyInstaller extracts to `_MEIXXXXXX` temp directory
- Use `binaries` in spec to bundle DLLs

**Common Windows DLLs needed**:
- MSVC Runtime (usually present)
- Hardware SDK DLLs (Pylon, NI-DAQmx)

### macOS

**Code Signing**:
- PyInstaller executables may need code signing
- Use `--codesign-identity` flag or sign post-build
- See `docs/PACKAGING.md` for details

**Dylib Paths**:
- macOS uses `@rpath`, `@executable_path`, `@loader_path`
- PyInstaller usually handles correctly
- May need `install_name_tool` adjustments

### Linux

**Shared Library Paths**:
- Linux uses `LD_LIBRARY_PATH` and `rpath`
- PyInstaller bundles most dependencies
- May need `LD_LIBRARY_PATH` set for hardware SDKs

## Verification Checklist

After building Python executable:

- [ ] Executable exists: `ls -lh dist/bloom-hardware`
- [ ] Executable runs: `./dist/bloom-hardware --ipc`
- [ ] IPC responds: `echo '{"command":"check_hardware"}' | ./dist/bloom-hardware --ipc`
- [ ] Integration tests pass: `npm run test:camera`
- [ ] No import errors in subprocess logs
- [ ] Hardware modules load correctly (check status messages)

## Build Script

**Location**: `scripts/build-python.js`

What it does:

1. Checks uv is installed
2. Syncs Python dependencies (`uv sync --extra dev`)
3. Cleans build cache (`build/`, `dist/`)
4. Runs PyInstaller (`uv run pyinstaller python/main.spec`)
5. Verifies output exists

## Debugging Tips

### Enable PyInstaller Debug Output

Edit `scripts/build-python.js`:

```javascript
execSync('uv run pyinstaller --debug all python/main.spec', {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
});
```

### Check Bundled Modules

```bash
# macOS/Linux - list bundled Python modules
unzip -l dist/bloom-hardware | grep '\.pyc'

# Windows - list bundled modules
7z l dist/bloom-hardware.exe | grep '.pyc'
```

### Test Import Directly

```bash
# Run Python in bundled environment
./dist/bloom-hardware
>>> import hardware.camera
>>> print(hardware.camera.__file__)
```

## Related Commands

- `/hardware-testing` - Testing hardware integration after build
- `/integration-testing` - Running integration tests with bundled executable
- `/packaging` - Packaging Python executable with Electron app

## Documentation

- **PyInstaller Guide**: `python/PYINSTALLER.md`
- **Packaging**: `docs/PACKAGING.md`