# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import copy_metadata, collect_data_files

block_cipher = None

# Copy package metadata to fix importlib.metadata.version() calls
# nidaqmx uses importlib.metadata.version(__name__) in __init__.py
# which requires the .dist-info directory to be bundled
datas = []
datas += copy_metadata('nidaqmx')
datas += copy_metadata('imageio')  # Required for imageio.v2 imports in camera modules

# Optional: Include nidaqmx data files (like _installer_metadata.json)
# This is used by the nidaqmx.installdriver() CLI command
datas += collect_data_files('nidaqmx', include_py_files=False)

a = Analysis(
    ['main.py'],
    pathex=['.', './python'],  # Include both project root and python/ for dual import paths
    binaries=[],
    datas=datas,
    hiddenimports=[
        'numpy',
        'pypylon',
        'imageio',
        'nidaqmx',
        'PIL',
        'PIL.Image',
        # Hardware modules - both import paths needed for bundled app
        # ipc_handler.py tries 'hardware.*' first, then falls back to 'python.hardware.*'
        'hardware',
        'hardware.camera',
        'hardware.camera_mock',
        'hardware.camera_types',
        'hardware.daq',
        'hardware.daq_mock',
        'hardware.daq_types',
        'hardware.scanner',
        'hardware.scanner_types',
        # Development/fallback import paths
        'python.hardware',
        'python.hardware.camera',
        'python.hardware.camera_mock',
        'python.hardware.camera_types',
        'python.hardware.daq',
        'python.hardware.daq_mock',
        'python.hardware.daq_types',
        'python.hardware.scanner',
        'python.hardware.scanner_types',
        # SANE scanner backend (python-sane)
        'sane',
        # IPC handler
        'ipc_handler',
        'python.ipc_handler',
        # GraviScan modules (scanner detection/scanning now handled by TypeScript + scan_worker.py)
        'graviscan',
        'graviscan.scan_regions',
        'graviscan.models',
        'graviscan.models.scanner_info',
        'graviscan.functions',
        'graviscan.functions.sane_scanner',
        'graviscan.functions.mock_scanner',
        'python.graviscan',
        'python.graviscan.scan_regions',
        'python.graviscan.models',
        'python.graviscan.models.scanner_info',
        'python.graviscan.functions',
        'python.graviscan.functions.sane_scanner',
        'python.graviscan.functions.mock_scanner',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'pytest',
        'pytest-cov',
        'pytest-mock',
        '_pytest',
        'tests',
        'python.tests',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

# Exclude system C libraries from bundle — they must come from the target system
# to match its GLIBC version. Bundling them from the build machine (GLIBC 2.41)
# causes "GLIBC_2.38 not found" errors on older Ubuntu/Debian systems.
# We keep only: Python (.so with 'python'), numpy, PIL/Pillow, pypylon, and other
# pip-installed package libs. Everything from /lib/ or /usr/lib/ is excluded.
import os as _os
def _is_system_lib(binary_tuple):
    """Return True if this binary comes from system paths and should be excluded."""
    name, path, *_ = binary_tuple
    if not path:
        return False
    # Always keep Python itself, numpy, PIL, pypylon, and package-installed libs
    _KEEP_PATTERNS = ('python', 'numpy', 'PIL', 'Pillow', 'pypylon', 'site-packages')
    if any(p in path for p in _KEEP_PATTERNS):
        return False
    # Exclude anything sourced from system lib directories
    _SYSTEM_PATHS = ('/lib/', '/lib64/', '/usr/lib/', '/usr/lib64/')
    return any(path.startswith(sp) or sp in path for sp in _SYSTEM_PATHS)

a.binaries = [b for b in a.binaries if not _is_system_lib(b)]

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='bloom-hardware',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
